export enum CefrLevel {
  A1 = 'A1',
  A2 = 'A2',
  B1 = 'B1',
  B2 = 'B2',
  C1 = 'C1',
  C2 = 'C2',
}

export enum ExerciseType {
  GRAMMAR = 'Grammar',
  VOCABULARY = 'Vocabulary & Image Matching',
  READING = 'Reading Comprehension',
  LISTENING = 'Listening Comprehension',
  SPEAKING = 'Speaking & Pronunciation',
}

export interface UserPreferences {
  level?: CefrLevel;
  topic: string;
  vocabulary: string;
  grammarFocus: string;
  selectedTypes: ExerciseType[];
  questionCount: number;
}

export interface Question {
  questionText: string;
  questionImage?: string; // Image for specific question (Vocabulary with images, Listening with images)
  imageDescription?: string; // Description of the image for Listening exercises (will be read aloud)
  audioData?: string; // Base64 encoded audio for Listening exercises (pre-generated)
  options: string[]; // For Multiple Choice
  correctAnswer: string;
  explanation: string;
  // For Speaking exercises
  targetPhrase?: string; // The phrase/sentence to pronounce
  pronunciationTips?: string; // Tips for pronunciation
}

export interface GeneratedSection {
  id: string;
  type: ExerciseType;
  title: string;
  instruction: string;
  contextText?: string; // The reading passage or listening script
  imageUrl?: string; // Kept for backward compatibility or future use, though unused now
  questions: Question[];
}

export interface GeneratedContent {
  sections: GeneratedSection[];
}

export interface VideoAnalysisResult {
  level: CefrLevel;
  topic: string;
  vocabulary: string;
  grammarFocus: string;
}

export interface StudentSubmission {
  type: 'submission';
  studentName: string;
  originalFileId: string | null; // ID of the exercise file
  score: { correct: number; total: number };
  feedback?: string; // Student feedback
  starRating?: number; // Star rating (1-5)
  userAnswers?: Record<string, string>; // Detailed answers for each question
  timestamp: number;
}

export interface GoogleFormConfig {
  formUrl: string; // The "formResponse" URL
  nameEntryId: string; // entry.123456 for Name
  scoreEntryId: string; // entry.654321 for Score
  feedbackEntryId: string; // entry.789012 for Feedback
  ratingEntryId?: string; // entry.1043069793 for Star Rating
}

export type LoadingStatus = 
  | 'idle' 
  | 'analyzing_video' 
  | 'generating_content' 
  | 'generating_images' 
  | 'loading_drive'
  | 'uploading';