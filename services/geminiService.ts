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
      1. **Topic Extraction (CRITICAL - Be Specific):**
         - Identify the SPECIFIC, CONCRETE topic being taught (e.g., "Morning routines and daily activities", "Describing family members", "Planning a vacation trip to Paris")
         - DO NOT use generic category names like "Basic abilities" or "Everyday objects"
         - Instead, describe what specific situation, context, or theme the lesson focuses on
         - If it's about abilities, specify WHAT abilities (e.g., "Physical abilities: running, jumping, climbing")
         - If it's about objects, specify the context (e.g., "Classroom objects: desk, chair, whiteboard")
      
      2. **Vocabulary Extraction (Critical - Content Words Only):**
         - Scan all text visible on the slides/whiteboard (OCR)
         - Extract ONLY CONTENT WORDS: nouns, meaningful verbs, adjectives, and adverbs
         - EXCLUDE all function words: pronouns (I, you, me, that), articles (a, an, the), prepositions (in, on, at, up), modal verbs (can, should, must), conjunctions (and, but, or), auxiliary verbs (is, are, was), contractions (I'm, what's, that's)
         - Focus on SUBSTANTIVE vocabulary that carries meaning: objects, actions, qualities, concepts
         - Prioritize topic-specific terminology over generic words
         - Aim for 20-40 meaningful content words/phrases
         - Examples of GOOD vocabulary: "airplane, passport, luggage, departure, arrival, reservation, itinerary"
         - Examples of BAD vocabulary to exclude: "can, I, you, me, that, the, is, are, what's, I'm"
      
      3. **Grammar Identification (Be Precise and Specific):**
         - Identify the SPECIFIC grammar structures being taught or prominently used
         - Be precise: Instead of "Modal verb 'can'", specify "Modal verb 'can' for expressing ability with physical actions"
         - Instead of "imperative sentences", specify "Imperative sentences for giving commands and instructions"
         - List 2-4 specific grammar points that are the FOCUS of the lesson
         - Format: "Grammar point 1: [specific structure] for [purpose/use]. Grammar point 2: [specific structure] for [purpose/use]."
         - DO NOT list every grammar structure that happens to appear - only the ones being actively taught
      
      4. **Level Assessment (CRITICAL - Analyze thoroughly):** 
         - Analyze the complexity of vocabulary used (basic everyday words = A1/A2, academic/professional terms = B2/C1/C2)
         - Examine sentence structures (simple sentences = A1/A2, complex clauses and advanced grammar = B2/C1/C2)
         - Look at the depth of content (basic topics = A1/A2, abstract concepts and nuanced discussions = B2/C1/C2)
         - Consider the sophistication of explanations and examples
         - Assess the overall linguistic complexity visible in the video
         - Determine the most appropriate CEFR level: A1 (Beginner), A2 (Elementary), B1 (Intermediate), B2 (Upper-Intermediate), C1 (Advanced), C2 (Proficient)
         - Be precise: if the content shows intermediate-level material, choose B1; if it shows advanced academic content, choose C1 or C2

      Return a JSON object matching the schema. For 'vocabulary', provide ONLY content words as a comma-separated string.
      For 'level', provide the most accurate CEFR level based on your comprehensive analysis.
    `;

    const schema = {
      type: Type.OBJECT,
      properties: {
        level: { type: Type.STRING, enum: Object.values(CefrLevel) },
        topic: { 
          type: Type.STRING, 
          description: "A specific, concrete topic (e.g., 'Morning routines and daily activities', NOT generic categories like 'Basic abilities')" 
        },
        vocabulary: { 
          type: Type.STRING, 
          description: "Comma-separated list of 20-40 CONTENT WORDS ONLY (nouns, meaningful verbs, adjectives, adverbs). EXCLUDE function words (pronouns, articles, prepositions, modals, conjunctions, auxiliaries, contractions). Focus on substantive vocabulary that carries meaning." 
        },
        grammarFocus: { 
          type: Type.STRING, 
          description: "2-4 specific grammar structures being actively taught, with their purpose/use. Format: 'Structure 1: [name] for [purpose]. Structure 2: [name] for [purpose].' Be precise and specific, not generic lists." 
        },
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

// Helper to shuffle array (Fisher-Yates)
const shuffleArray = (array: string[]) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
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
    Role: You are an expert ESL (English as a Second Language) Curriculum Designer.
    Task: Create a structured, pedagogical Homework Assignment based on the provided context.
    
    Context & Requirements:
    - CEFR Level: ${prefs.level ? `${prefs.level} - Create exercises appropriate for this level. Adjust vocabulary complexity, sentence structures, and content depth accordingly.` : "Not specified - Use intermediate level (B1-B2) as default"}
    - Topic/Theme: ${prefs.topic || "General"}
    - Target Vocabulary: ${selectedVocabulary}
    - Target Grammar: ${prefs.grammarFocus || "Mixed grammar"}
    - Question Count per Section: ${prefs.questionCount}
    - Required Section Types: ${prefs.selectedTypes.join(", ")}
    
    Pedagogical Instructions:
    1. **Distractor Quality (CRITICAL):** In multiple-choice questions, distractors must be "smart". They should represent common learner mistakes (e.g., L1 interference, false cognates, or incorrect tense application) relevant to the ${prefs.level} level.
    2. **Scaffolding:** Arrange questions from simple recognition (Vocabulary) to complex application (Reading/Speaking).
    3. **Natural Language:** Ensure the "contextText" for Reading sounds like a real-world text (email, blog post, news snippet), not just a list of sentences.
    4. **Image Descriptions:** For Listening, ensure 'imageDescription' focuses on high-contrast, clear actions that can be distinguished easily by an Image Gen model.

    Cohesion & Flow Strategy (CRITICAL):
    - Treat this set of exercises as a cohesive homework assignment revolving around the Topic: "${prefs.topic || "General"}".
    - Step 1: Establish a specific context or mini-story related to the Topic (e.g., if Topic is "Travel", the context could be "A family planning a summer trip to Japan").
    - Step 2: Use this specific context across ALL sections.
      - **Vocabulary:** Introduce words relevant to this specific context.
      - **Reading:** Write a passage about this specific context, using the introduced vocabulary.
      - **Listening:** Create scenes/dialogues within this same context.
      - **Grammar:** Use sentences that fit this context (not random sentences).
      - **Speaking:** Practice phrases useful in this context.
    - Reinforcement: Recycle the target vocabulary and grammar points across different sections to reinforce learning.

    IMPORTANT: 
    - Create EXACTLY ONE section for EACH selected exercise type.
    - For example, if "Speaking & Pronunciation" is selected, create only 1 Speaking section with ${prefs.questionCount} questions.
    - ${prefs.level ? `Ensure ALL exercises are appropriate for ${prefs.level} level: vocabulary difficulty, grammar complexity, reading passage complexity, and speaking phrases should match this level.` : ''}
    
    For 'Grammar' sections:
      - Create sentences with a blank to fill in (e.g., "She ___ to the store yesterday.").
      - 'correctAnswer' is the word/phrase that fills the blank correctly.
      - 'options' MUST include 3 distractors that are the SAME PART OF SPEECH as the correct answer.
      - CRITICAL: Do NOT use random words for options. If the answer is a verb, all options must be verbs. If the answer is a preposition, all options must be prepositions.
      - Distractors should test common grammar mistakes (e.g., wrong tense: "go/went/gone", wrong form: "good/well", similar words).
      - Ensure the sentence provides CLEAR context clues (time markers, subject-verb agreement cues, logical meaning) so that ONLY ONE answer is logically and grammatically correct.
      - Avoid ambiguous sentences where multiple options could technically fit (e.g., instead of "He ___ run", use "He ___ run fast when he was young" to force 'could').

    For 'Listening Comprehension' sections (TOEIC Part 1 style):
      - Each question should have an image showing a simple, clear scene related to the established context.
      - The 'correctAnswer' must be EXACTLY one of the options you provide.
      - In 'imageDescription', provide a visual description of the scene solely for generating the image. This will NOT be read aloud.
      - The 'questionText' should be simple like "What do you see in this picture?" or "Listen and choose the correct description".
      - Provide 4 SHORT options (each 3-7 words) describing different scenarios. Only one matches the image.
      - IMPORTANT: The 'correctAnswer' must be EXACTLY identical to one of the 4 options you provide.
      - Avoid using random names (e.g., "Leo", "Anna") unless they were introduced in the main context/story. Use generic subjects like "A man", "The woman", "A student" instead.
      - Ensure options are plausible but clearly distinct (e.g., "A man is running" vs "A man is sitting").
      - The image will be auto-generated based on the correctAnswer.
      - DO NOT include 'contextText' for Listening sections.
    
    For 'Reading Comprehension' sections:
      - Create a cohesive passage in the 'contextText' field that relates to the established context/story.
      - The passage should be appropriate for the CEFR level and incorporate the target vocabulary when possible.
      - Each question should test comprehension of the passage (main ideas, details, inferences, vocabulary in context).
      - 'questionText' should be a clear question about the passage (e.g., "What is the main idea of the passage?" or "According to the passage, why did...?").
      - Provide 4 options for each question. The 'correctAnswer' must be EXACTLY one of the options (word-for-word match).
      - Distractors should be plausible but clearly wrong based on the passage content.
      - Ensure questions can be answered by reading the passage (not requiring outside knowledge).
    
    For 'Vocabulary & Image Matching' sections:
      - The 'correctAnswer' must be a concrete noun, object, or action that can be easily visualized.
      - The 'questionText' should be like "Choose the word that matches the image" or "What does this picture show?".
      - Provide 4 options total: the correct answer plus 3 distractors.
      - IMPORTANT: The 'correctAnswer' must be EXACTLY identical to one of the 4 options you provide (same text, word-for-word match).
      - Distractors should be related words (similar meaning, same category) but clearly different from the correct answer.
      - All options should be single words or short phrases (1-3 words max).
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
                  imageDescription: { type: Type.STRING, description: "For listening exercises: visual description of the image scene for generating the image only. This will NOT be read aloud." },
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

    // Clean up and validate: Remove contextText from Listening sections (legacy format)
    // Validate that correctAnswer matches one of the options for multiple choice sections
    content.sections.forEach(section => {
      if (section.type === ExerciseType.LISTENING && section.contextText) {
        delete section.contextText;
      }
      
      // Validate multiple choice exercises: correctAnswer must match one of the options
      // This applies to LISTENING, READING, VOCABULARY, and GRAMMAR (all have options)
      const needsValidation = [
        ExerciseType.LISTENING,
        ExerciseType.READING,
        ExerciseType.VOCABULARY,
        ExerciseType.GRAMMAR
      ].includes(section.type);
      
      if (needsValidation && Array.isArray(section.questions)) {
        section.questions.forEach((question, qIdx) => {
          // Shuffle options for LISTENING exercises
          if (section.type === ExerciseType.LISTENING && question.options && question.options.length > 0) {
            question.options = shuffleArray([...question.options]);
          }

          if (question.options && question.options.length > 0 && question.correctAnswer) {
            const normalize = (s: string) => s.trim().toLowerCase();
            const normalizedCorrect = normalize(question.correctAnswer);
            const matchingOption = question.options.find(opt => normalize(opt) === normalizedCorrect);
            
            if (!matchingOption) {
              // If no exact match found, try to find the closest match using startsWith
              const closestMatch = question.options.find(opt => 
                normalize(opt).startsWith(normalizedCorrect) || 
                normalizedCorrect.startsWith(normalize(opt))
              );
              
              if (closestMatch) {
                // Update correctAnswer to match the option exactly
                console.warn(`${section.type} question ${qIdx}: correctAnswer "${question.correctAnswer}" adjusted to match option "${closestMatch}"`);
                question.correctAnswer = closestMatch;
              } else {
                // If still no match, use the first option as fallback (should not happen with improved prompt)
                console.warn(`${section.type} question ${qIdx}: correctAnswer "${question.correctAnswer}" does not match any option. Using first option as fallback.`);
                question.correctAnswer = question.options[0];
              }
            } else {
              // Ensure exact match (use the option text exactly as it appears)
              question.correctAnswer = matchingOption;
            }
          } 
        });
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
          // Clear any existing audio data first to prevent stale data
          question.audioData = undefined;
          
          // Build the audio text: question + options
          // Standardized format: "Question text. Option A: ... Option B: ..."
          let parts: string[] = [];
          
          // 1. Add the question text
          if (question.questionText) {
            parts.push(question.questionText);
            // Add a pause after question
            parts.push("..."); 
          }
          
          // 2. Add options with letters (A, B, C, D) corresponding to their SHUFFLED position
          if (question.options && question.options.length > 0) {
            question.options.forEach((opt: string, i: number) => {
              const letter = String.fromCharCode(65 + i); // A, B, C, D
              // Format: "A. [Option Text]"
              parts.push(`${letter}. ${opt}.`); 
            });
          } else {
            console.warn(`Listening question missing options array or empty options`);
          }
          
          // Join with natural pauses
          const audioText = parts.join(' ');
          
          // Validate audio text has sufficient content
          // For a proper listening question, we need: questionText + at least 4 options
          // Minimum expected: ~100 characters for a meaningful question with 4 short options
          if (!question.options || question.options.length === 0) {
            console.error(`Listening question missing options! Audio will be incomplete.`);
          } else if (question.options.length < 4) {
            console.warn(`Listening question has only ${question.options.length} options, expected 4.`);
          }
          
          if (audioText.length < 100) {
            console.warn(`Audio text may be too short (${audioText.length} chars) for question. Expected ~100+ chars for proper question + 4 options.`);
            console.warn(`Audio text content: "${audioText}"`);
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
          await new Promise(resolve => setTimeout(resolve, 2500)); // Increased to 2500ms for better reliability
        }
        
        // Generate audio with retry logic - ensure we get full audio
        let audioData: string | undefined = undefined;
        let retryCount = 0;
        const maxRetries = 3; // Increased retries
        
        // Log the audio text being generated for debugging
        console.log(`Generating audio for Listening question ${i + 1}: "${audioText}" (${audioText.length} characters)`);
        
        // Estimate expected audio length: roughly 100 chars of text ≈ 10-15 seconds of speech
        // Base64 encoding: ~1.3x the original audio size
        // For 142-184 chars of text, expect ~15-20 seconds of speech ≈ 20,000-30,000 base64 chars minimum
        const estimatedMinLength = Math.max(15000, audioText.length * 100); // Conservative estimate
        
        while (!audioData && retryCount <= maxRetries) {
          if (retryCount > 0) {
            // Wait progressively longer between retries to give API time to recover
            const waitTime = 3500 + (retryCount * 2000); // 3s, 5s, 7s
            console.log(`Retrying audio generation for question ${i + 1}, attempt ${retryCount + 1}/${maxRetries}, waiting ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            // Even for first attempt, add a small delay to ensure API is ready
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          audioData = await generateAudioBase64(audioText);
          
          // Validate audio data is not empty or too short
          if (audioData) {
            if (audioData.length < estimatedMinLength) {
              console.warn(`Audio data too short for question ${i + 1}: ${audioData.length} chars, expected at least ${estimatedMinLength} chars (estimated from ${audioText.length} chars of text). Retrying...`);
              audioData = undefined;
            } else {
              console.log(`✓ Audio generated successfully for question ${i + 1}: ${audioData.length} chars`);
            }
          }
          
          retryCount++;
        }
        
        if (audioData) {
          question.audioData = audioData;
        } else {
          console.warn(`Failed to generate audio for question ${i} after ${maxRetries} retries.`);
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
  const model = "gemini-2.5-flash-preview-tts";

  try {
    // Ensure text is properly formatted with pauses
    // Replace double periods with single period + space for better TTS parsing
    const formattedText = text
    .replace(/\.\.\./g, ' . ') // Replace "..." with period for natural pause
    .replace(/([.?!])\s*/g, "$1 ") // Standardize sentence breaks
    .replace(/([,])\s*/g, "$1 ")   // Standardize comma breaks
    .trim();
    const response = await withRetry(
      () => ai.models.generateContent({
        model: model,
        contents: [{ parts: [{ text: formattedText }] }],
        config: {
          systemInstruction: { parts: [{ text: "You are a Text-to-Speech system. Your ONLY task is to read the provided text aloud naturally and clearly. Do NOT generate any text, analysis, or descriptions. Just generate the audio for the input text." }] },
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Aoede' }, // Clear voice
            },
          },
        },
      }),
      2, // Fewer retries here since we handle retries in the caller
      "Audio generation"
    );

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      console.warn("No audio data returned from API");
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
  const model = "gemini-2.5-flash";

  try {
    // Comment: API bên ngoài đang bị lỗi, sử dụng Gemini thay thế
    /*
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
    */

    // Chuyển đổi audioBlob thành base64 để gửi đến Gemini
    const audioBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        // Loại bỏ data URL prefix (data:audio/webm;base64,)
        const base64Data = base64String.split(',')[1] || base64String;
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(audioBlob);
    });

    // Xác định MIME type từ blob
    const mimeType = audioBlob.type || 'audio/webm';

    // Tách target phrase thành các từ để đánh giá từng từ
    const words = targetPhrase.trim().split(/\s+/).filter(w => w.length > 0);

    const prompt = `
Bạn là một chuyên gia đánh giá phát âm tiếng Anh. Nhiệm vụ của bạn là phân tích đoạn ghi âm và so sánh với cụm từ mục tiêu: "${targetPhrase}"

Hãy đánh giá phát âm theo các tiêu chí sau:

1. **Pronunciation Score (0-100)**: Đánh giá tổng thể về chất lượng phát âm
2. **Accuracy Score (0-100)**: Độ chính xác của các âm vị (phonemes) so với cách phát âm chuẩn
3. **Fluency Score (0-100)**: Độ trôi chảy và tự nhiên của lời nói (nhịp điệu, ngắt nghỉ)
4. **Completeness Score (0-100)**: Mức độ hoàn chỉnh - người nói đã nói đủ các từ trong cụm từ mục tiêu chưa

5. **Word-by-word Feedback**: Đánh giá từng từ trong cụm từ "${targetPhrase}"
   - Với mỗi từ, cung cấp:
     * Từ đó
     * Status: 'correct' (≥80), 'partial' (50-79), hoặc 'incorrect' (<50)
     * Score (0-100): Điểm phát âm của từ đó

Hãy trả về kết quả dưới dạng JSON với cấu trúc:
{
  "pronunciationScore": <số 0-100>,
  "accuracyScore": <số 0-100>,
  "fluencyScore": <số 0-100>,
  "completenessScore": <số 0-100>,
  "wordFeedback": [
    {
      "word": "<từ>",
      "status": "correct" | "partial" | "incorrect",
      "score": <số 0-100>
    },
    ...
  ]
}

Lưu ý:
- Hãy đánh giá một cách công bằng và khách quan
- Nếu người nói phát âm tốt nhưng thiếu một số từ, completenessScore sẽ thấp hơn
- Nếu phát âm rõ ràng nhưng không tự nhiên, fluencyScore sẽ thấp hơn
- accuracyScore tập trung vào độ chính xác của các âm vị
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
          description: "Phoneme accuracy score (0-100)" 
        },
        fluencyScore: { 
          type: Type.NUMBER, 
          description: "Speech fluency and naturalness score (0-100)" 
        },
        completenessScore: { 
          type: Type.NUMBER, 
          description: "Completeness score - how much of target phrase was spoken (0-100)" 
        },
        wordFeedback: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              status: { 
                type: Type.STRING, 
                enum: ['correct', 'partial', 'incorrect'] 
              },
              score: { type: Type.NUMBER }
            },
            required: ["word", "status", "score"]
          }
        }
      },
      required: ["pronunciationScore", "accuracyScore", "fluencyScore", "completenessScore", "wordFeedback"]
    };

    const contents = {
      parts: [
        {
          inlineData: {
            data: audioBase64,
            mimeType: mimeType
          }
        },
        { text: prompt }
      ]
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
      "Pronunciation evaluation"
    );

    const text = response.text;
    if (!text) throw new Error("No pronunciation assessment generated");

    const result = JSON.parse(text) as {
      pronunciationScore: number;
      accuracyScore: number;
      fluencyScore: number;
      completenessScore: number;
      wordFeedback: Array<{ word: string; status: 'correct' | 'partial' | 'incorrect'; score: number }>;
    };

    // Đảm bảo wordFeedback có đủ số lượng từ
    // Nếu Gemini trả về ít hơn, thêm các từ còn lại với status 'incorrect'
    const existingWords = result.wordFeedback.map(w => w.word.toLowerCase());
    const missingWords = words.filter(w => !existingWords.includes(w.toLowerCase()));
    
    missingWords.forEach(word => {
      result.wordFeedback.push({
        word: word,
        status: 'incorrect',
        score: 0
      });
    });

    // Đảm bảo các điểm số nằm trong khoảng 0-100
    const clampScore = (score: number) => Math.max(0, Math.min(100, Math.round(score)));

    return {
      pronunciationScore: clampScore(result.pronunciationScore),
      accuracyScore: clampScore(result.accuracyScore),
      fluencyScore: clampScore(result.fluencyScore),
      completenessScore: clampScore(result.completenessScore),
      wordFeedback: result.wordFeedback.map(w => ({
        word: w.word,
        status: w.status,
        score: clampScore(w.score)
      }))
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