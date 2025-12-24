import React, { useState, useMemo } from 'react';
import { GeneratedContent } from '../types';
import ExerciseCard from './ExerciseCard';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginatedExerciseViewProps {
  content: GeneratedContent;
  userAnswers: Record<string, string>;
  onAnswerSelect: (sectionIdx: number, questionIdx: number, option: string) => void;
  isSubmitted: boolean;
  showAnswersGlobal: boolean;
  questionsPerPage?: number;
}

interface QuestionWithSection {
  section: any;
  sectionIndex: number;
  questionIndex: number;
  question: any;
  page: number;
}

const PaginatedExerciseView: React.FC<PaginatedExerciseViewProps> = ({
  content,
  userAnswers,
  onAnswerSelect,
  isSubmitted,
  showAnswersGlobal,
  questionsPerPage = 1
}) => {
  // Flatten all questions from all sections with page info
  const allQuestions: (QuestionWithSection & { page: number })[] = useMemo(() => {
    const questions: (QuestionWithSection & { page: number })[] = [];
    content.sections.forEach((section, sIdx) => {
      section.questions.forEach((question, qIdx) => {
        const questionIndex = questions.length;
        questions.push({
          section,
          sectionIndex: sIdx,
          questionIndex: qIdx,
          question,
          page: Math.floor(questionIndex / questionsPerPage)
        });
      });
    });
    return questions;
  }, [content, questionsPerPage]);

  const totalPages = Math.ceil(allQuestions.length / questionsPerPage);
  const [currentPage, setCurrentPage] = useState(0);

  // Get questions for current page
  const currentPageQuestions = useMemo(() => {
    const start = currentPage * questionsPerPage;
    const end = start + questionsPerPage;
    return allQuestions.slice(start, end);
  }, [currentPage, questionsPerPage, allQuestions]);

  // Group questions by section for rendering
  const questionsBySection = useMemo(() => {
    const grouped: Record<number, QuestionWithSection[]> = {};
    currentPageQuestions.forEach((q) => {
      if (!grouped[q.sectionIndex]) {
        grouped[q.sectionIndex] = [];
      }
      grouped[q.sectionIndex].push(q);
    });
    return grouped;
  }, [currentPageQuestions]);

  const goToPage = (page: number) => {
    if (page >= 0 && page < totalPages) {
      setCurrentPage(page);
      // Scroll to top when changing pages on mobile for better focus
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const goToNext = () => goToPage(currentPage + 1);
  const goToPrevious = () => goToPage(currentPage - 1);

  // Calculate progress percentage
  const progress = ((currentPage + 1) / totalPages) * 100;

  return (
    <div className="w-full">
      {/* Progress Bar - Compact on mobile */}
      <div className="mb-4 md:mb-6">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs md:text-sm font-medium text-slate-600">
            Câu {currentPage * questionsPerPage + 1} / {allQuestions.length}
          </span>
          <span className="text-xs md:text-sm font-medium text-slate-600 hidden sm:inline">
            Trang {currentPage + 1} / {totalPages}
          </span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2 md:h-2.5 overflow-hidden">
          <div 
            className="bg-gradient-to-r from-antoree-green to-green-600 h-full rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* All Questions - Render all but hide non-current page */}
      <div className="space-y-4 md:space-y-6 mb-4 md:mb-8">
        {allQuestions.map((q) => {
          // Only show questions from current page
          const isVisible = q.page === currentPage;
          
          // Create a modified section with only this question
          const modifiedSection = {
            ...q.section,
            questions: [q.question]
          };

          return (
            <div
              key={`q-${q.sectionIndex}-${q.questionIndex}`}
              className={isVisible ? '' : 'hidden'}
            >
              <ExerciseCard
                section={modifiedSection}
                sectionIndex={q.sectionIndex}
                baseQuestionIndex={q.questionIndex}
                userAnswers={userAnswers}
                onAnswerSelect={onAnswerSelect}
                isSubmitted={isSubmitted}
                showAnswersGlobal={showAnswersGlobal}
              />
            </div>
          );
        })}
      </div>

      {/* Navigation - Simplified on mobile, full on desktop */}
      <div className="flex items-center justify-between mt-6 md:mt-8 pt-4 md:pt-6 border-t border-slate-200">
        <button
          onClick={goToPrevious}
          disabled={currentPage === 0}
          className={`flex items-center justify-center gap-2 px-4 md:px-6 py-3 md:py-3 rounded-xl font-semibold transition-all min-w-[100px] md:min-w-[120px] ${
            currentPage === 0
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-antoree-green text-white active:bg-antoree-darkGreen shadow-md active:shadow-lg active:scale-95'
          }`}
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="hidden sm:inline">Trước</span>
          <span className="sm:hidden">‹</span>
        </button>

        {/* Page Indicators - Hidden on small screens, shown on md+ */}
        <div className="hidden md:flex items-center gap-2">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
            // Show pages around current page
            let pageNum;
            if (totalPages <= 10) {
              pageNum = i;
            } else if (currentPage < 5) {
              pageNum = i;
            } else if (currentPage > totalPages - 6) {
              pageNum = totalPages - 10 + i;
            } else {
              pageNum = currentPage - 5 + i;
            }

            return (
              <button
                key={pageNum}
                onClick={() => goToPage(pageNum)}
                className={`w-10 h-10 rounded-lg font-semibold transition-all ${
                  pageNum === currentPage
                    ? 'bg-antoree-green text-white shadow-md scale-110'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {pageNum + 1}
              </button>
            );
          })}
        </div>

        {/* Current page indicator for mobile */}
        <div className="md:hidden text-sm font-medium text-slate-600 px-2">
          {currentPage + 1} / {totalPages}
        </div>

        <button
          onClick={goToNext}
          disabled={currentPage === totalPages - 1}
          className={`flex items-center justify-center gap-2 px-4 md:px-6 py-3 md:py-3 rounded-xl font-semibold transition-all min-w-[100px] md:min-w-[120px] ${
            currentPage === totalPages - 1
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-antoree-green text-white active:bg-antoree-darkGreen shadow-md active:shadow-lg active:scale-95'
          }`}
        >
          <span className="hidden sm:inline">Sau</span>
          <span className="sm:hidden">›</span>
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default PaginatedExerciseView;

