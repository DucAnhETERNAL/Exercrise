import React, { useRef, useState } from 'react';
import { CefrLevel, ExerciseType, UserPreferences } from '../types';
import { Type, GraduationCap, LayoutList, Hash, Video, Upload, Loader2 } from 'lucide-react';
import { analyzeVideoForPreferences } from '../services/geminiService';

interface InputFormProps {
  preferences: UserPreferences;
  onChange: (prefs: UserPreferences) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

const InputForm: React.FC<InputFormProps> = ({ preferences, onChange, onSubmit, isLoading }) => {
  const [analyzingVideo, setAnalyzingVideo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChange = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    onChange({ ...preferences, [key]: value });
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
    try {
      const result = await analyzeVideoForPreferences(file);
      // Auto-populate
      onChange({
        ...preferences,
        level: result.level,
        topic: result.topic,
        vocabulary: result.vocabulary,
        grammarFocus: result.grammarFocus,
      });
    } catch (error) {
      alert("Failed to analyze video. Please try a different file.");
      console.error(error);
    } finally {
      setAnalyzingVideo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
      <h2 className="text-xl font-semibold text-slate-800 mb-6 flex items-center gap-2">
        <LayoutList className="w-5 h-5 text-indigo-600" />
        Configuration
      </h2>

      {/* Video Analysis Section */}
      <div className="mb-8 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
        <div className="flex items-center gap-2 mb-2">
          <Video className="w-5 h-5 text-indigo-600" />
          <h3 className="font-semibold text-indigo-900">Auto-configure from Video</h3>
        </div>
        <p className="text-sm text-indigo-700 mb-4">
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
          className="w-full py-3 bg-white border-2 border-indigo-200 text-indigo-700 rounded-lg font-semibold hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2"
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
        {/* Level & Topic */}
        <div className="grid grid-cols-1 gap-6">
          <div>
            <label className="block text-base font-semibold text-slate-700 mb-2">CEFR Level</label>
            <div className="relative">
              <GraduationCap className="absolute left-4 top-4 w-5 h-5 text-slate-400" />
              <select
                className="w-full pl-12 pr-4 py-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none appearance-none bg-white text-black text-lg shadow-sm"
                value={preferences.level}
                onChange={(e) => handleChange('level', e.target.value as CefrLevel)}
              >
                {Object.values(CefrLevel).map((lvl) => (
                  <option key={lvl} value={lvl}>{lvl}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-base font-semibold text-slate-700 mb-2">Topic / Theme</label>
            <div className="relative">
              <Type className="absolute left-4 top-4 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="e.g. Travel, Business, Technology"
                className="w-full pl-12 pr-4 py-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-black text-lg shadow-sm"
                value={preferences.topic}
                onChange={(e) => handleChange('topic', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Detailed Inputs */}
        <div className="grid grid-cols-1 gap-6">
          <div>
            <label className="block text-base font-semibold text-slate-700 mb-2">Vocabulary List (Optional)</label>
            <textarea
              className="w-full p-4 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-base bg-white text-black shadow-sm"
              rows={3}
              placeholder="e.g. ubiquitous, ephemeral, serene..."
              value={preferences.vocabulary}
              onChange={(e) => handleChange('vocabulary', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-base font-semibold text-slate-700 mb-2">Grammar Focus (Optional)</label>
            <textarea
              className="w-full p-4 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-base bg-white text-black shadow-sm"
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
                    ? 'bg-indigo-600 text-white border-indigo-600 border'
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
           <div className="relative w-full md:w-1/2">
             <Hash className="absolute left-4 top-4 w-5 h-5 text-slate-400" />
             <input 
                type="number" 
                min={1} 
                max={10}
                value={preferences.questionCount}
                onChange={(e) => handleChange('questionCount', parseInt(e.target.value) || 5)}
                className="w-full pl-12 pr-4 py-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-black text-lg shadow-sm"
             />
           </div>
        </div>

        <button
          onClick={onSubmit}
          disabled={isLoading || preferences.selectedTypes.length === 0}
          className={`w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg transition-all transform hover:-translate-y-0.5 ${
            isLoading || preferences.selectedTypes.length === 0
              ? 'bg-slate-300 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-xl'
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