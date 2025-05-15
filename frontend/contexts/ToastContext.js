// frontend/contexts/ToastContext.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import Toast from '../components/Toast'; // Add this import

// Create context
const ToastContext = createContext(null);

// Toast type definitions
export const TOAST_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

// Default duration
const DEFAULT_DURATION = 5000; // 5 seconds

// Toast Provider component
export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  // Add a new toast notification
  const addToast = (message, type = TOAST_TYPES.INFO, duration = DEFAULT_DURATION) => {
    const id = Date.now().toString();
    const newToast = {
      id,
      message,
      type,
      duration,
    };

    setToasts(prevToasts => [...prevToasts, newToast]);

    // Remove toast after duration
    if (duration !== 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }

    return id;
  };

  // Remove a toast by ID
  const removeToast = (id) => {
    setToasts(prevToasts => prevToasts.filter(toast => toast.id !== id));
  };

  // Convenience methods for different toast types
  const success = (message, duration) => addToast(message, TOAST_TYPES.SUCCESS, duration);
  const error = (message, duration) => addToast(message, TOAST_TYPES.ERROR, duration);
  const warning = (message, duration) => addToast(message, TOAST_TYPES.WARNING, duration);
  const info = (message, duration) => addToast(message, TOAST_TYPES.INFO, duration);

  // Clear all toasts
  const clearToasts = () => {
    setToasts([]);
  };

  // Context value
  const value = {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    warning,
    info,
    clearToasts,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
};

// Toast Container component
const ToastContainer = ({ toasts, removeToast }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-0 right-0 p-4 space-y-4 z-50">
      <div className="flex flex-col space-y-2">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            toast={toast}
            onClose={removeToast}
          />
        ))}
      </div>
    </div>
  );
};

// Custom hook to use the toast context
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export default ToastContext;