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
      Your goal is to extract the MAXIMUM amount of learning data possible from these visuals.

      Please perform a deep analysis:
      1. **Vocabulary Extraction (Critical):** Scan all text visible on the slides/whiteboard (OCR). Extract a COMPREHENSIVE list of vocabulary (aim for 30-50+ words/phrases if available). Focus on the specific terminology used in the lesson, not just basic words.
      2. **Grammar Identification:** Look at the sentence structures shown on the slides. Identify the specific grammar points being taught or used (e.g., "Third Conditional," "Passive Voice with Modals," "Advanced Relative Clauses"). Be precise.
      3. **Topic:** Define the specific academic or conversational topic.
      4. **Level:** Assess CEFR level based on the complexity of the written text and grammar on the slides.

      Return a JSON object matching the schema. For 'vocabulary', provide a comma-separated string of the extensive list.
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
    - Topic/Theme: ${prefs.topic || "General"}
    - Target Vocabulary: ${selectedVocabulary}
    - Target Grammar: ${prefs.grammarFocus || "Mixed grammar"}
    - Question Count per Section: ${prefs.questionCount}
    - Required Section Types: ${prefs.selectedTypes.join(", ")}
    
    IMPORTANT: Create EXACTLY ONE section for EACH selected exercise type.
    For example, if "Speaking & Pronunciation" is selected, create only 1 Speaking section with ${prefs.questionCount} questions.
    
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
            contextText: { type: Type.STRING, description: "Reading passage or listening script" },
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
    const audioGenerationPromises: Promise<void>[] = [];

    content.sections.forEach(section => {
      if (section.type === ExerciseType.LISTENING && Array.isArray(section.questions)) {
        section.questions.forEach(question => {
          audioGenerationPromises.push((async () => {
            // Build the audio text: question + options
            let audioText = question.questionText;
            
            // Add options with letters (A, B, C, D)
            if (question.options && question.options.length > 0) {
              question.options.forEach((opt: string, i: number) => {
                const letter = String.fromCharCode(65 + i);
                audioText += `. Option ${letter}, ${opt}`;
              });
            }
            
            // Generate audio once and store as base64
            const audioData = await generateAudioBase64(audioText);
            if (audioData) {
              question.audioData = audioData;
            }
          })());
        });
      }
    });

    if (audioGenerationPromises.length > 0) {
      await Promise.all(audioGenerationPromises);
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
  const model = "gemini-2.5-flash-preview-tts";

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
      2, // Fewer retries for audio (non-critical)
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
  const model = "gemini-2.5-flash-preview-tts";

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
export interface PronunciationFeedback {
  pronunciationScore: number; // 0-100 - Overall pronunciation quality
  accuracyScore: number; // 0-100 - Accuracy of phoneme pronunciation
  fluencyScore: number; // 0-100 - Smoothness and naturalness of speech
  completenessScore: number; // 0-100 - How much of the target phrase was spoken
}

export const evaluatePronunciation = async (
  audioBlob: Blob,
  targetPhrase: string
): Promise<PronunciationFeedback> => {
  const model = "gemini-2.5-flash";

  try {
    // Convert blob to base64
    const base64Audio = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Extract base64 data (remove data:audio/webm;base64, prefix)
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(audioBlob);
    });

    const prompt = `
      You are a pronunciation assessment system similar to Azure Speech Service.
      Evaluate this audio recording where the student was asked to say: "${targetPhrase}"
      
      Provide detailed metrics (0-100 scale for each):
      
      1. **Accuracy Score**: How accurately were the individual phonemes/sounds pronounced?
         - 90-100: Native-like accuracy
         - 70-89: Good accuracy with minor errors
         - 50-69: Noticeable pronunciation errors
         - Below 50: Significant pronunciation issues
      
      2. **Fluency Score**: How smooth, natural, and confident was the delivery?
         - Considers: pace, rhythm, hesitations, false starts
         - 90-100: Very smooth and natural
         - 70-89: Generally fluent with minor pauses
         - 50-69: Some hesitations or unnatural pace
         - Below 50: Choppy or very hesitant
      
      3. **Completeness Score**: How much of the target phrase was actually spoken?
         - 100: All words spoken
         - 70-99: Most words spoken
         - 50-69: Half or more spoken
         - Below 50: Less than half spoken
      
      4. **Pronunciation Score**: Overall weighted score combining the above metrics.
         - Formula: (Accuracy * 0.5 + Fluency * 0.3 + Completeness * 0.2)
      
      Be objective and precise in your assessment, similar to Azure Speech Service.
    `;

    const schema = {
      type: Type.OBJECT,
      properties: {
        pronunciationScore: { 
          type: Type.NUMBER, 
          description: "Overall pronunciation quality score (0-100)" 
        },
        accuracyScore: { 
          type: Type.NUMBER, 
          description: "Accuracy of phoneme pronunciation (0-100)" 
        },
        fluencyScore: { 
          type: Type.NUMBER, 
          description: "Smoothness and naturalness of speech (0-100)" 
        },
        completenessScore: { 
          type: Type.NUMBER, 
          description: "How much of target phrase was spoken (0-100)" 
        }
      },
      required: ["pronunciationScore", "accuracyScore", "fluencyScore", "completenessScore"]
    };

    const response = await withRetry(
      () => ai.models.generateContent({
        model: model,
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Audio,
                mimeType: audioBlob.type || 'audio/webm'
              }
            },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
      3,
      "Pronunciation evaluation"
    );

    const text = response.text;
    if (!text) throw new Error("No evaluation generated");

    return JSON.parse(text) as PronunciationFeedback;

  } catch (error: any) {
    const errorMessage = error?.message || error?.error?.message || "Unknown error";
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