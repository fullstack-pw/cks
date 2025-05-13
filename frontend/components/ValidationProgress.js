// frontend/components/ValidationProgress.js
import React from 'react';
import { Card } from './common';

const ValidationProgress = ({ stages, currentStage }) => {
  return (
    <Card className="mb-4 bg-blue-50">
      <div className="p-4">
        <h4 className="text-sm font-medium text-blue-900 mb-3">Validation Progress</h4>
        <div className="space-y-2">
          {stages.map((stage, index) => {
            const isCurrentStage = index === currentStage;
            const isCompleted = index < currentStage;
            const isPending = index > currentStage;

            return (
              <div key={index} className="flex items-center">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center mr-3 ${isCompleted ? 'bg-green-500' :
                    isCurrentStage ? 'bg-blue-500 animate-pulse' :
                      'bg-gray-300'
                  }`}>
                  {isCompleted ? (
                    <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : isCurrentStage ? (
                    <div className="w-2 h-2 bg-white rounded-full"></div>
                  ) : (
                    <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                  )}
                </div>
                <div className="flex-1">
                  <p className={`text-sm ${isCompleted ? 'text-green-700' :
                      isCurrentStage ? 'text-blue-700 font-medium' :
                        'text-gray-500'
                    }`}>
                    {stage.name}
                  </p>
                  {isCurrentStage && stage.message && (
                    <p className="text-xs text-blue-600 mt-1">{stage.message}</p>
                  )}
                </div>
                {isCurrentStage && (
                  <div className="ml-3">
                    <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};

export default ValidationProgress;