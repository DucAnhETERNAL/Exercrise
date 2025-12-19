import { GoogleGenAI, Type, Modality } from "@google/genai";
import { UserPreferences, ExerciseType, GeneratedContent, VideoAnalysisResult, CefrLevel, LoadingStatus } from "../types";

// Use process.env.API_KEY as primary source.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Retry wrapper for Gemini API calls with exponential backoff.
 * Handles 503 (Service Unavailable) and other retryable errors.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  operationName: string = "API call"
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      // Check multiple error formats from the SDK
      const errorCode = error?.code || error?.error?.code;
      const errorStatus = error?.status || error?.error?.status;
      const errorMessage = error?.message || error?.error?.message || JSON.stringify(error);
      
      const isRetryable = 
        errorCode === 503 ||
        errorStatus === 503 ||
        errorStatus === "UNAVAILABLE" ||
        errorMessage?.includes('503') ||
        errorMessage?.includes('overloaded') ||
        errorMessage?.includes('Service Unavailable') ||
        errorMessage?.includes('UNAVAILABLE');

      if (isRetryable && attempt < retries) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 10000); // Exponential backoff, max 10s
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // If not retryable or out of retries, throw the error
      throw error;
    }
  }
  throw new Error("Retry logic failed unexpectedly");
}

/**
 * Helper to extract frames from a video file evenly distributed across its duration.
 * This allows analyzing the full context of large videos (e.g., 1 hour long) 
 * without hitting payload limits.
 */
const extractFramesFromVideo = async (videoFile: File, frameCount: number = 20): Promise<{ inlineData: { data: string; mimeType: string } }[]> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const frames: { inlineData: { data: string; mimeType: string } }[] = [];
    
    // Create URL for the file (efficient, doesn't load whole file to RAM)
    const videoUrl = URL.createObjectURL(videoFile);
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.crossOrigin = "anonymous";

    const MAX_DIMENSION = 800;
    let cleanupDone = false;

    const cleanup = () => {
      if (cleanupDone) return;
      cleanupDone = true;
      try {
        URL.revokeObjectURL(videoUrl);
        video.src = ''; // Clear src to stop loading
        video.remove();
        canvas.remove();
      } catch (e) {
        // Cleanup error ignored
      }
    };

    // Timeout for entire operation (30 seconds per frame * frameCount, max 5 minutes)
    const globalTimeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Video frame extraction timeout after ${frameCount * 30}s`));
    }, Math.min(frameCount * 30000, 300000));

    video.onloadedmetadata = async () => {
      try {
        clearTimeout(globalTimeout); // Clear global timeout once metadata is loaded
        
        const originalWidth = video.videoWidth;
        const originalHeight = video.videoHeight;
        
        if (!originalWidth || !originalHeight) {
          throw new Error("Video metadata invalid");
        }

        // Calculate scaled dimensions
        let width = originalWidth;
        let height = originalHeight;
        
        if (width > height) {
          if (width > MAX_DIMENSION) {
            height = Math.round(height * MAX_DIMENSION / width);
            width = MAX_DIMENSION;
          }
        } else {
          if (height > MAX_DIMENSION) {
            width = Math.round(width * MAX_DIMENSION / height);
            height = MAX_DIMENSION;
          }
        }
        
        // Set canvas to scaled dimensions (not original)
        canvas.width = width;
        canvas.height = height;
        
        const duration = video.duration;
        if (!duration || isNaN(duration)) {
          throw new Error("Video duration invalid");
        }
        
        // Calculate timestamps to capture
        const timePoints: number[] = [];
        for (let i = 0; i < frameCount; i++) {
          // distribute frames from 2% to 98% of the video to catch intro and summary
          const percent = 0.02 + (0.96 * i / (frameCount - 1));
          timePoints.push(duration * percent);
        }

        // Extract frames sequentially
        for (let i = 0; i < timePoints.length; i++) {
          const time = timePoints[i];
          
          await new Promise<void>((seekResolve, seekReject) => {
            // Timeout for seek operation (5 seconds per frame)
            const timeoutId = setTimeout(() => {
              video.removeEventListener('seeked', onSeeked);
              seekReject(new Error(`Timeout seeking to ${time.toFixed(2)}s`));
            }, 5000);

            const onSeeked = () => {
              clearTimeout(timeoutId);
              video.removeEventListener('seeked', onSeeked);
              
              try {
                // Draw frame with scaled dimensions
                if (ctx && video.readyState >= 2) { // HAVE_CURRENT_DATA
                  ctx.drawImage(video, 0, 0, width, height);
                  // Export to base64
                  const base64String = canvas.toDataURL('image/jpeg', 0.4);
                  frames.push({
                    inlineData: {
                      data: base64String.split(',')[1],
                      mimeType: 'image/jpeg',
                    }
                  });
                }
                seekResolve();
              } catch (e) {
                seekReject(e);
              }
            };
            
            video.addEventListener('seeked', onSeeked);
            video.currentTime = time;
          });
        }
        
        cleanup();
        resolve(frames);
      } catch (e) {
        cleanup();
        clearTimeout(globalTimeout);
        reject(e);
      }
    };

    video.onerror = (e) => {
      cleanup();
      clearTimeout(globalTimeout);
      reject(new Error(`Could not load video file: ${video.error?.message || 'Unknown error'}`));
    };
  });
};

/**
 * Analyzes a video file to determine CEFR Level, Topic, Vocab, and Grammar.
 * Uses frame extraction to "see" the entire video content.
 */
export const analyzeVideoForPreferences = async (
  videoFile: File,
  onStatusUpdate?: (status: LoadingStatus) => void
): Promise<VideoAnalysisResult> => {
  const model = "gemini-2.5-flash"; // Flash handles multiple images well

  try {
    if (onStatusUpdate) onStatusUpdate('analyzing_video');
    
    // Extract frames (increased to 20 for better coverage)
    const frames = await extractFramesFromVideo(videoFile, 20); 
    
    const prompt = `
      I have provided ${frames.length} screenshots taken at regular intervals from a single long video (e.g., 1 hour lecture).
      Your goal is to extract the MAXIMUM amount of learning data possible from these visuals, with special focus on accurately determining the student's CEFR level.

      Please perform a comprehensive analysis:
      1. **Vocabulary Extraction (Critical):** Scan all text visible on the slides/whiteboard (OCR). Extract a COMPREHENSIVE list of vocabulary (aim for 30-50+ words/phrases if available). Focus on the specific terminology used in the lesson, not just basic words.
      2. **Grammar Identification:** Look at the sentence structures shown on the slides. Identify the specific grammar points being taught or used (e.g., "Third Conditional," "Passive Voice with Modals," "Advanced Relative Clauses"). Be precise.
      3. **Topic:** Define the specific academic or conversational topic.
      4. **Level Assessment (CRITICAL - Analyze thoroughly):** 
         - Analyze the complexity of vocabulary used (basic everyday words = A1/A2, academic/professional terms = B2/C1/C2)
         - Examine sentence structures (simple sentences = A1/A2, complex clauses and advanced grammar = B2/C1/C2)
         - Look at the depth of content (basic topics = A1/A2, abstract concepts and nuanced discussions = B2/C1/C2)
         - Consider the sophistication of explanations and examples
         - Assess the overall linguistic complexity visible in the video
         - Determine the most appropriate CEFR level: A1 (Beginner), A2 (Elementary), B1 (Intermediate), B2 (Upper-Intermediate), C1 (Advanced), C2 (Proficient)
         - Be precise: if the content shows intermediate-level material, choose B1; if it shows advanced academic content, choose C1 or C2

      Return a JSON object matching the schema. For 'vocabulary', provide a comma-separated string of the extensive list.
      For 'level', provide the most accurate CEFR level based on your comprehensive analysis.
    `;

    const schema = {
      type: Type.OBJECT,
      properties: {
        level: { type: Type.STRING, enum: Object.values(CefrLevel) },
        topic: { type: Type.STRING },
        vocabulary: { type: Type.STRING, description: "A comprehensive comma-separated list of 30-50 words found in the video." },
        grammarFocus: { type: Type.STRING, description: "Precise grammar structures identified from the text on slides." },
      },
      required: ["level", "topic", "vocabulary", "grammarFocus"]
    };

    // Combine frames and prompt into contents
    const contents = {
      parts: [...frames, { text: prompt }]
    };

    const response = await withRetry(
      () => ai.models.generateContent({
        model: model,
        contents: contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
      3,
      "Video analysis"
    );

    const text = response.text;
    if (!text) throw new Error("No analysis generated");

    return JSON.parse(text) as VideoAnalysisResult;

  } catch (error: any) {
    // Check multiple error formats
    const errorCode = error?.code || error?.error?.code;
    const errorStatus = error?.status || error?.error?.status;
    const errorMessage = error?.message || error?.error?.message || "Unknown error";
    
    // Provide more specific error messages
    if (errorCode === 503 || errorStatus === 503 || errorStatus === "UNAVAILABLE" || errorMessage?.includes('overloaded')) {
      throw new Error("Gemini model is currently overloaded. Please try again in a few moments.");
    }
    
    if (errorMessage?.includes('API_KEY') || errorCode === 401 || errorStatus === 401) {
      throw new Error("Invalid API key. Please check your GEMINI_API_KEY in environment variables.");
    }
    
    throw new Error(`Failed to analyze video: ${errorMessage}. Ensure the video format is supported by your browser.`);
  }
};

/**
 * Generates a digital illustration for a given context.
 */
export const generateImage = async (promptText: string): Promise<string | undefined> => {
  const model = "gemini-2.5-flash-image"; 

  try {
    const prompt = `Draw a clean, educational digital illustration suitable for an English learning flashcard representing: ${promptText}. No text inside the image.`;
    
    const response = await withRetry(
      () => ai.models.generateContent({
        model: model,
        contents: { parts: [{ text: prompt }] },
        config: {
          imageConfig: {
            aspectRatio: "1:1", // Square aspect ratio for flashcard style
          }
        }
      }),
      2, // Fewer retries for image generation (non-critical)
      "Image generation"
    );

    // Extract image from response
    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }
    return undefined;
  } catch (error) {
    return undefined; // Fail silently
  }
};

/**
 * Helper function to randomly select vocabulary words from a comma-separated list
 */
const selectRandomVocabulary = (vocabularyList: string, count: number = 15): string => {
  if (!vocabularyList || vocabularyList.trim() === "") {
    return "Mixed vocabulary";
  }
  
  // Split by comma and clean up whitespace
  const words = vocabularyList.split(',').map(w => w.trim()).filter(w => w.length > 0);
  
  // If we have fewer words than requested, return all
  if (words.length <= count) {
    return words.join(', ');
  }
  
  // Randomly select 'count' words using Fisher-Yates shuffle
  const shuffled = [...words];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled.slice(0, count).join(', ');
};

/**
 * Generates the text-based exercises using a structured JSON schema.
 */
export const generateExercises = async (
  prefs: UserPreferences, 
  onStatusUpdate?: (status: LoadingStatus) => void
): Promise<GeneratedContent> => {
  const model = "gemini-2.5-flash";

  if (onStatusUpdate) onStatusUpdate('generating_content');

  // Randomly select vocabulary words for variety
  const selectedVocabulary = selectRandomVocabulary(prefs.vocabulary || "", 15);

  const prompt = `
    Create a set of English exercises for daily assessment.
    
    Context & Requirements:
    - CEFR Level: ${prefs.level ? `${prefs.level} - Create exercises appropriate for this level. Adjust vocabulary complexity, sentence structures, and content depth accordingly.` : "Not specified - Use intermediate level (B1-B2) as default"}
    - Topic/Theme: ${prefs.topic || "General"}
    - Target Vocabulary: ${selectedVocabulary}
    - Target Grammar: ${prefs.grammarFocus || "Mixed grammar"}
    - Question Count per Section: ${prefs.questionCount}
    - Required Section Types: ${prefs.selectedTypes.join(", ")}
    
    IMPORTANT: 
    - Create EXACTLY ONE section for EACH selected exercise type.
    - For example, if "Speaking & Pronunciation" is selected, create only 1 Speaking section with ${prefs.questionCount} questions.
    - ${prefs.level ? `Ensure ALL exercises are appropriate for ${prefs.level} level: vocabulary difficulty, grammar complexity, reading passage complexity, and speaking phrases should match this level.` : ''}
    
    For 'Listening Comprehension' sections (TOEIC Part 1 style):
      - Each question should have an image showing a simple, clear scene (people, objects, actions).
      - The 'correctAnswer' must be a concrete visual scene that can be drawn (e.g., "A man riding a bicycle", "People sitting in a meeting room").
      - In 'imageDescription', provide a SHORT and CONCISE description (1-2 sentences max, suitable for homework) of the image scene that will be read aloud to students. Keep it simple and clear.
      - The 'questionText' should be simple like "What do you see in this picture?" or "Listen and choose the correct description".
      - Provide 4 SHORT options (each 3-7 words) describing different scenarios. Only one matches the image.
      - Keep options concise for easy listening comprehension in homework setting.
      - The image will be auto-generated based on the correctAnswer.
      - DO NOT include 'contextText' for Listening sections (each question is independent).
    
    For 'Reading Comprehension' sections, create a passage in the 'contextText' field.
    
    For 'Vocabulary & Image Matching' sections:
      - The 'correctAnswer' must be a concrete noun, object, or action that can be easily visualized.
      - The 'questionText' should be like "Choose the word that matches the image" or "What does this picture show?".
      - Provide 3 distractors in 'options'.
      - The image will be auto-generated based on the correctAnswer.
    
    For 'Speaking & Pronunciation' sections:
      - Create natural sentences or phrases for students to practice pronunciation.
      - In 'targetPhrase', put the exact phrase they need to say.
      - In 'pronunciationTips', give guidance on difficult sounds or intonation.
      - In 'correctAnswer', repeat the targetPhrase.
      - In 'questionText', write instructions like "Read this sentence aloud" or "Pronounce this phrase".
      - Set 'options' to an empty array [] since it's not multiple choice.
    
    Ensure the English is natural and appropriate for daily practice.
    ${prefs.level ? `CRITICAL: All exercises must match ${prefs.level} level standards. Use vocabulary, grammar structures, and content complexity appropriate for ${prefs.level} learners.` : ''}
    Return the response as a valid JSON object matching the schema.
  `;

  // Define the schema for structured output
  // Added 'required' fields to enforce structure and prevent undefined properties
  const schema = {
    type: Type.OBJECT,
    properties: {
      sections: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            type: { 
              type: Type.STRING, 
              enum: [
                ExerciseType.GRAMMAR, 
                ExerciseType.VOCABULARY, 
                ExerciseType.READING, 
                ExerciseType.LISTENING,
                ExerciseType.SPEAKING
              ] 
            },
            title: { type: Type.STRING },
            instruction: { type: Type.STRING },
            contextText: { type: Type.STRING, description: "ONLY for Reading Comprehension sections. DO NOT use for Listening (each question is independent)." },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionText: { type: Type.STRING },
                  imageDescription: { type: Type.STRING, description: "For listening exercises: description of the image that will be read aloud" },
                  options: { 
                    type: Type.ARRAY, 
                    items: { type: Type.STRING },
                    description: "Array of 4 options for multiple choice (empty for speaking)" 
                  },
                  correctAnswer: { type: Type.STRING },
                  explanation: { type: Type.STRING, description: "Short explanation of why this answer is correct" },
                  targetPhrase: { type: Type.STRING, description: "For speaking exercises: the phrase to pronounce" },
                  pronunciationTips: { type: Type.STRING, description: "For speaking exercises: pronunciation guidance" }
                },
                required: ["questionText", "correctAnswer"]
              }
            }
          },
          required: ["id", "type", "title", "instruction", "questions"]
        }
      }
    },
    required: ["sections"]
  };

  try {
    // 1. Generate Text Content
    const response = await withRetry(
      () => ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.7, 
        },
      }),
      3,
      "Exercise generation"
    );

    const text = response.text;
    if (!text) throw new Error("No response text generated");
    
    let content: GeneratedContent;
    try {
        content = JSON.parse(text) as GeneratedContent;
    } catch (e) {
        throw new Error("Failed to parse response JSON.");
    }

    // Safety check: ensure sections exists to prevent 'undefined reading forEach' error
    if (!content || !Array.isArray(content.sections)) {
        content = { sections: [] };
    }

    // Clean up: Remove contextText from Listening sections (legacy format)
    content.sections.forEach(section => {
      if (section.type === ExerciseType.LISTENING && section.contextText) {
        delete section.contextText;
      }
    });

    // 2. Post-process: Generate Images for Vocabulary and Listening sections
    // We do this by creating a list of promises to run in parallel
    const imageGenerationPromises: Promise<void>[] = [];

    content.sections.forEach(section => {
      if (section.type === ExerciseType.VOCABULARY && Array.isArray(section.questions)) {
        if (onStatusUpdate && imageGenerationPromises.length === 0) {
            onStatusUpdate('generating_images');
        }
        section.questions.forEach(question => {
          // Push a promise to generate an image for this specific question
          imageGenerationPromises.push((async () => {
            // We use the correct answer as the prompt for the image
            const imgData = await generateImage(question.correctAnswer);
            if (imgData) {
              question.questionImage = imgData;
            }
          })());
        });
      }
      
      // Generate images for Listening sections (TOEIC Part 1 style)
      if (section.type === ExerciseType.LISTENING && Array.isArray(section.questions)) {
        if (onStatusUpdate && imageGenerationPromises.length === 0) {
            onStatusUpdate('generating_images');
        }
        section.questions.forEach(question => {
          // Push a promise to generate an image for this specific question
          imageGenerationPromises.push((async () => {
            // We use the correct answer as the prompt for the image
            const imgData = await generateImage(question.correctAnswer);
            if (imgData) {
              question.questionImage = imgData;
            }
          })());
        });
      }
    });

    if (imageGenerationPromises.length > 0) {
      await Promise.all(imageGenerationPromises);
    }

    // 3. Post-process: Generate Audio for Listening sections (Cost-optimized: generate once)
    // Process sequentially with delay to avoid rate limiting and audio quality issues
    const audioTasks: Array<{ question: any; audioText: string }> = [];

    content.sections.forEach(section => {
      if (section.type === ExerciseType.LISTENING && Array.isArray(section.questions)) {
        section.questions.forEach(question => {
          // Build the audio text: question + options
          let audioText = question.questionText;
          
          // Add options with letters (A, B, C, D)
          if (question.options && question.options.length > 0) {
            question.options.forEach((opt: string, i: number) => {
              const letter = String.fromCharCode(65 + i);
              audioText += `.  ${letter}, ${opt}`;
            });
          }
          
          audioTasks.push({ question, audioText });
        });
      }
    });

    // Process audio generation sequentially with delay to avoid rate limiting
    // This prevents audio quality issues when generating more than 4 questions
    if (audioTasks.length > 0) {
      for (let i = 0; i < audioTasks.length; i++) {
        const { question, audioText } = audioTasks[i];
        
        // Add delay between requests (except for the first one)
        // INCREASE DELAY to avoid rate limiting/partial generation
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Increased from 800ms to 2000ms
        }
        
        // Generate audio once and store as base64
        const audioData = await generateAudioBase64(audioText);
        if (audioData) {
          question.audioData = audioData;
        } else {
            console.warn(`Failed to generate audio for question ${i}. Falling back...`);
        }
      }
    }

    return content;
  } catch (error: any) {
    // Check multiple error formats
    const errorCode = error?.code || error?.error?.code;
    const errorStatus = error?.status || error?.error?.status;
    const errorMessage = error?.message || error?.error?.message || "Unknown error";
    
    // Provide more specific error messages
    if (errorCode === 503 || errorStatus === 503 || errorStatus === "UNAVAILABLE" || errorMessage?.includes('overloaded')) {
      throw new Error("Gemini model is currently overloaded. Please try again in a few moments.");
    }
    
    if (errorMessage?.includes('API_KEY') || errorCode === 401 || errorStatus === 401) {
      throw new Error("Invalid API key. Please check your GEMINI_API_KEY in environment variables.");
    }
    
    throw error;
  }
};

/**
 * Generates audio from text and returns base64 encoded audio data.
 * This is optimized for cost - generate once and reuse.
 */
export const generateAudioBase64 = async (text: string): Promise<string | undefined> => {
  const model = "gemini-2.0-flash-exp"; // Model hỗ trợ TTS tốt nhất hiện nay

  try {
    const response = await withRetry(
      () => ai.models.generateContent({
        model: model,
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Aoede' }, // Clear voice
            },
          },
        },
      }),
      3, // Increased retries from 2 to 3
      "Audio generation"
    );

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      return undefined;
    }

    // Return base64 data directly for storage
    return base64Audio;

  } catch (error) {
    console.error("Audio generation failed:", error);
    return undefined; // Fail silently
  }
};

/**
 * Generates audio from text for Listening exercises.
 * @deprecated Use generateAudioBase64 for better cost optimization
 */
export const generateAudio = async (text: string): Promise<AudioBuffer> => {
  const model = "gemini-2.0-flash-exp";

  try {
    const response = await withRetry(
      () => ai.models.generateContent({
        model: model,
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Aoede' }, // 'Aoede' is a good clear voice
            },
          },
        },
      }),
      3,
      "Audio generation"
    );

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error("No audio data returned");
    }

    // Decode audio
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const audioBuffer = await decodeAudioData(
      decode(base64Audio),
      audioContext,
      24000,
      1
    );

    return audioBuffer;

  } catch (error) {
    throw error;
  }
};

/**
 * Evaluates pronunciation by comparing recorded audio with target phrase.
 * Uses Gemini's multimodal capabilities to assess pronunciation quality.
 * Returns detailed metrics similar to Azure Speech Service.
 */
export interface WordFeedback {
  word: string;
  status: 'correct' | 'partial' | 'incorrect'; // correct = green, partial = yellow, incorrect = red
  score?: number; // 0-100 for this word
}

export interface PronunciationFeedback {
  pronunciationScore: number; // 0-100 - Overall pronunciation quality
  accuracyScore: number; // 0-100 - Accuracy of phoneme pronunciation
  fluencyScore: number; // 0-100 - Smoothness and naturalness of speech
  completenessScore: number; // 0-100 - How much of the target phrase was spoken
  wordFeedback: WordFeedback[]; // Word-by-word analysis
}

export const evaluatePronunciation = async (
  audioBlob: Blob,
  targetPhrase: string
): Promise<PronunciationFeedback> => {
  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('referenceText', targetPhrase);
    formData.append('locale', 'en-US');
    // Default level if not provided (you might want to pass this from props later)
    formData.append('level', 'A1'); 

    const response = await fetch('https://market-api.antoree.com/api/v1/pronunciation/quick-assess', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.success || !result.data) {
       throw new Error("API returned unsuccessful response or missing data");
    }

    const scores = result.data.scores;
    const words = result.data.words;

    // Map Antoree API response to our PronunciationFeedback interface
    const wordFeedback: WordFeedback[] = words.map((w: any) => {
      let status: 'correct' | 'partial' | 'incorrect' = 'incorrect';
      const score = w.PronunciationAssessment?.AccuracyScore || 0;

      if (score >= 80) {
        status = 'correct';
      } else if (score >= 50) {
        status = 'partial';
      }

      return {
        word: w.Word,
        status: status,
        score: score
      };
    });

    return {
      pronunciationScore: scores.pronunciation,
      accuracyScore: scores.accuracy,
      fluencyScore: scores.fluency,
      completenessScore: scores.completeness,
      wordFeedback: wordFeedback
    };

  } catch (error: any) {
    console.error("Pronunciation assessment failed:", error);
    const errorMessage = error?.message || "Unknown error";
    throw new Error(`Failed to evaluate pronunciation: ${errorMessage}`);
  }
};

// Helper to decode base64 to Uint8Array
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper to decode PCM data into an AudioBuffer
async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Convert Int16 PCM to Float32 [-1.0, 1.0]
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}