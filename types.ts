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
  VOCABULARY = 'Vocabulary',
  READING = 'Reading Comprehension',
  LISTENING = 'Listening Comprehension',
  IMAGE_MATCHING = 'Image Matching',
}

export interface UserPreferences {
  topic: string;
  vocabulary: string;
  grammarFocus: string;
  selectedTypes: ExerciseType[];
  questionCount: number;
}

export interface Question {
  questionText: string;
  questionImage?: string; // Image for specific question (Image Matching)
  options: string[]; // For Multiple Choice
  correctAnswer: string;
  explanation: string;
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
  timestamp: number;
}

export interface GoogleFormConfig {
  formUrl: string; // The "formResponse" URL
  nameEntryId: string; // entry.123456 for Name
  scoreEntryId: string; // entry.654321 for Score
  feedbackEntryId: string; // entry.789012 for Feedback
}

export type LoadingStatus = 
  | 'idle' 
  | 'analyzing_video' 
  | 'generating_content' 
  | 'generating_images' 
  | 'loading_drive'
  | 'uploading';