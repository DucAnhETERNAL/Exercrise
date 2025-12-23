import React, { useRef, useState, useEffect } from 'react';
import { CefrLevel, ExerciseType, UserPreferences, LoadingStatus } from '../types';
import { Type, LayoutList, Hash, Video, Upload, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import { analyzeVideoForPreferences } from '../services/geminiService';
import { useAlert } from '../contexts/AlertContext';

interface InputFormProps {
  preferences: UserPreferences;
  onChange: (prefs: UserPreferences) => void;
  onSubmit: () => void;
  loadingStatus: LoadingStatus;
  onVideoAnalysisStatusChange?: (status: LoadingStatus) => void;
}

const InputForm: React.FC<InputFormProps> = ({ preferences, onChange, onSubmit, loadingStatus, onVideoAnalysisStatusChange }) => {
  const { showAlert } = useAlert();
  const [analyzingVideo, setAnalyzingVideo] = useState(false);
  const [questionCountError, setQuestionCountError] = useState<string | null>(null);
  const [questionCountInput, setQuestionCountInput] = useState<string>(preferences.questionCount.toString());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLoading = loadingStatus !== 'idle';
  
  // Sync input when preferences.questionCount changes externally
  useEffect(() => {
    setQuestionCountInput(preferences.questionCount.toString());
  }, [preferences.questionCount]);
  
  const handleChange = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    onChange({ ...preferences, [key]: value });
  };

  const handleQuestionCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    
    // Allow empty string (for clearing)
    if (value === '') {
      setQuestionCountInput('');
      setQuestionCountError(null);
      return;
    }
    
    // Only allow digits
    if (!/^\d+$/.test(value)) {
      setQuestionCountError('Vui lòng chỉ nhập số');
      return;
    }
    
    const numValue = parseInt(value);
    
    // Check if it's 0
    if (numValue === 0) {
      setQuestionCountInput(value);
      setQuestionCountError('Số câu hỏi phải lớn hơn 0');
      return;
    }
    
    // Check if it exceeds max
    if (numValue > 20) {
      setQuestionCountInput(value);
      setQuestionCountError('Số câu hỏi tối đa là 20');
      return;
    }
    
    // Valid value - update both input and preferences
    setQuestionCountInput(value);
    handleChange('questionCount', numValue);
    setQuestionCountError(null);
  };

  const handleIncrement = () => {
    const currentValue = preferences.questionCount || 1;
    if (currentValue < 20) {
      const newValue = currentValue + 1;
      handleChange('questionCount', newValue);
      setQuestionCountInput(newValue.toString());
      setQuestionCountError(null);
    } else {
      setQuestionCountError('Số câu hỏi tối đa là 20');
    }
  };

  const handleDecrement = () => {
    const currentValue = preferences.questionCount || 1;
    if (currentValue > 1) {
      const newValue = currentValue - 1;
      handleChange('questionCount', newValue);
      setQuestionCountInput(newValue.toString());
      setQuestionCountError(null);
    } else {
      setQuestionCountError('Số câu hỏi phải lớn hơn 0');
    }
  };

  const handleSubmit = () => {
    // Validate questionCount before submitting
    const count = preferences.questionCount;
    if (!count || count < 1) {
      setQuestionCountError('Vui lòng nhập số câu hỏi (từ 1 đến 20)');
      return;
    }
    if (count > 20) {
      setQuestionCountError('Số câu hỏi tối đa là 20');
      return;
    }
    
    setQuestionCountError(null);
    onSubmit();
  };

  const toggleType = (type: ExerciseType) => {
    const current = preferences.selectedTypes;
    if (current.includes(type)) {
      handleChange('selectedTypes', current.filter(t => t !== type));
    } else {
      handleChange('selectedTypes', [...current, type]);
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalyzingVideo(true);
    if (onVideoAnalysisStatusChange) {
      onVideoAnalysisStatusChange('analyzing_video');
    }
    
    try {
      const result = await analyzeVideoForPreferences(file, onVideoAnalysisStatusChange);
      // Auto-populate including level
      onChange({
        ...preferences,
        level: result.level,
        topic: result.topic,
        vocabulary: result.vocabulary,
        grammarFocus: result.grammarFocus,
      });
    } catch (error: any) {
      const errorMessage = error?.message || "Failed to analyze video";
      showAlert(errorMessage + (errorMessage.includes("overloaded") ? "\n\nHệ thống sẽ tự động thử lại. Vui lòng đợi một chút và thử lại." : ""), 'error');
    } finally {
      setAnalyzingVideo(false);
      if (onVideoAnalysisStatusChange) {
        onVideoAnalysisStatusChange('idle');
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
      <h2 className="text-xl font-semibold text-slate-800 mb-6 flex items-center gap-2">
        <LayoutList className="w-5 h-5 text-antoree-green" />
        Configuration
      </h2>

      {/* Video Analysis Section */}
      <div className="mb-8 p-4 bg-antoree-lightGreen rounded-xl border border-green-100">
        <div className="flex items-center gap-2 mb-2">
          <Video className="w-5 h-5 text-antoree-green" />
          <h3 className="font-semibold text-antoree-green">Auto-configure from Video</h3>
        </div>
        <p className="text-sm text-antoree-darkGreen mb-4">
          Upload a video to automatically detect Level, Topic, Vocabulary, and Grammar. 
          (Large videos will be sampled).
        </p>
        
        <input 
          type="file" 
          accept="video/*" 
          ref={fileInputRef}
          className="hidden" 
          onChange={handleVideoUpload}
        />
        
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={analyzingVideo || isLoading}
          className="w-full py-3 bg-white border-2 border-green-200 text-antoree-green rounded-lg font-semibold hover:bg-antoree-lightGreen transition-colors flex items-center justify-center gap-2"
        >
          {analyzingVideo ? (
             <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
             <Upload className="w-5 h-5" />
          )}
          {analyzingVideo ? 'Analyzing Content...' : 'Upload Video'}
        </button>
      </div>
      
      <div className="space-y-6">
        {/* Level */}
        <div>
          <label className="block text-base font-semibold text-slate-700 mb-2">CEFR Level</label>
          <div className="flex flex-wrap gap-2">
            {Object.values(CefrLevel).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => handleChange('level', level)}
                className={`px-5 py-3 rounded-full text-sm font-medium transition-colors shadow-sm ${
                  preferences.level === level
                    ? 'bg-antoree-green text-white border-antoree-green border'
                    : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Chọn level để tạo đề phù hợp với trình độ học viên
          </p>
        </div>

        {/* Topic */}
        <div>
          <label className="block text-base font-semibold text-slate-700 mb-2">Topic / Theme</label>
          <div className="relative">
            <Type className="absolute left-4 top-4 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="e.g. Travel, Business, Technology"
              className="w-full pl-12 pr-4 py-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-antoree-green outline-none bg-white text-black text-lg shadow-sm"
              value={preferences.topic}
              onChange={(e) => handleChange('topic', e.target.value)}
            />
          </div>
        </div>

        {/* Detailed Inputs */}
        <div className="grid grid-cols-1 gap-6">
          <div>
            <label className="block text-base font-semibold text-slate-700 mb-2">Vocabulary List (Optional)</label>
            <textarea
              className="w-full p-4 border border-slate-200 rounded-xl focus:ring-2 focus:ring-antoree-green outline-none text-base bg-white text-black shadow-sm"
              rows={3}
              placeholder="e.g. ubiquitous, ephemeral, serene..."
              value={preferences.vocabulary}
              onChange={(e) => handleChange('vocabulary', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-base font-semibold text-slate-700 mb-2">Grammar Focus (Optional)</label>
            <textarea
              className="w-full p-4 border border-slate-200 rounded-xl focus:ring-2 focus:ring-antoree-green outline-none text-base bg-white text-black shadow-sm"
              rows={3}
              placeholder="e.g. Present Perfect, Conditionals..."
              value={preferences.grammarFocus}
              onChange={(e) => handleChange('grammarFocus', e.target.value)}
            />
          </div>
        </div>

        {/* Types & Count */}
        <div>
          <label className="block text-base font-semibold text-slate-700 mb-3">Exercise Types</label>
          <div className="flex flex-wrap gap-2">
            {Object.values(ExerciseType).map((type) => (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`px-5 py-3 rounded-full text-sm font-medium transition-colors shadow-sm ${
                  preferences.selectedTypes.includes(type)
                    ? 'bg-antoree-green text-white border-antoree-green border'
                    : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div>
           <label className="block text-base font-semibold text-slate-700 mb-2">Questions per Section</label>
           <div className="relative w-full">
             <Hash className="absolute left-4 top-4 w-5 h-5 text-slate-400 z-10" />
             <input 
                type="text" 
                inputMode="numeric"
                min={1} 
                max={20}
                value={questionCountInput}
                onChange={handleQuestionCountChange}
                onBlur={() => {
                  // If empty on blur, set to default 5
                  if (questionCountInput === '' || preferences.questionCount < 1) {
                    handleChange('questionCount', 5);
                    setQuestionCountInput('5');
                    setQuestionCountError(null);
                  } else {
                    // Ensure input matches the actual value
                    setQuestionCountInput(preferences.questionCount.toString());
                  }
                }}
                className={`w-full pl-12 pr-16 py-3.5 border rounded-xl focus:ring-2 focus:ring-antoree-green outline-none bg-white text-black text-lg shadow-sm ${
                  questionCountError ? 'border-red-300 focus:ring-red-500' : 'border-slate-200'
                }`}
                placeholder="Nhập số câu hỏi"
             />
             {/* Spinner buttons */}
             <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col">
               <button
                 type="button"
                 onClick={handleIncrement}
                 disabled={preferences.questionCount >= 20}
                 className="p-1 hover:bg-slate-100 rounded-t-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                 aria-label="Tăng số câu hỏi"
               >
                 <ChevronUp className="w-4 h-4 text-slate-600" />
               </button>
               <button
                 type="button"
                 onClick={handleDecrement}
                 disabled={preferences.questionCount <= 1}
                 className="p-1 hover:bg-slate-100 rounded-b-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed border-t border-slate-200"
                 aria-label="Giảm số câu hỏi"
               >
                 <ChevronDown className="w-4 h-4 text-slate-600" />
               </button>
             </div>
           </div>
           {questionCountError && (
             <p className="mt-2 text-sm text-red-600">{questionCountError}</p>
           )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={isLoading || preferences.selectedTypes.length === 0 || !!questionCountError}
          className={`w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg transition-all transform hover:-translate-y-0.5 ${
            isLoading || preferences.selectedTypes.length === 0 || !!questionCountError
              ? 'bg-slate-300 cursor-not-allowed'
              : 'bg-antoree-green hover:bg-antoree-darkGreen hover:shadow-xl'
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating Exercises...
            </span>
          ) : (
            'Generate Exercises'
          )}
        </button>
      </div>
    </div>
  );
};

export default InputForm;