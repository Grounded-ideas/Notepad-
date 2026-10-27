import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';

// TypeScript interfaces for File System Access API
interface FileSystemHandle {
  kind: 'file' | 'directory';
  name: string;
}

interface FileSystemFileHandle extends FileSystemHandle {
  kind: 'file';
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: object) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: object) => Promise<FileSystemFileHandle>;
  }
}

export default function App() {
  const [content, setContent] = useState<string>('');
  const [initialContent, setInitialContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('Untitled.txt');
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);

  // Dialog state
  const [showUnsavedModal, setShowUnsavedModal] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<'new' | 'open' | null>(null);

  // Hidden file input fallback for browsers without File System Access API
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const isDirty = content !== initialContent;

  // Refs for state inside keyboard shortcuts to prevent closure staleness
  const stateRef = useRef({
    content,
    initialContent,
    isDirty,
    fileHandle,
    fileName,
    showUnsavedModal,
  });

  useEffect(() => {
    stateRef.current = {
      content,
      initialContent,
      isDirty,
      fileHandle,
      fileName,
      showUnsavedModal,
    };
  }, [content, initialContent, isDirty, fileHandle, fileName, showUnsavedModal]);

  // Handle Monaco Mount
  const handleEditorDidMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor;

    // Define minimalist clean light theme
    monacoInstance.editor.defineTheme('win7-minimal', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: '', foreground: '111827' },
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#111827',
        'editorCursor.foreground': '#000000',
        'editor.lineHighlightBackground': '#00000000',
        'editor.selectionBackground': '#b3d7ff',
        'editor.inactiveSelectionBackground': '#e5edf6',
      },
    });

    monacoInstance.editor.setTheme('win7-minimal');
    editor.focus();
  };

  // Perform Save action
  const performSave = async (): Promise<boolean> => {
    const currentContent = stateRef.current.content;
    const currentHandle = stateRef.current.fileHandle;
    const currentFileName = stateRef.current.fileName;

    try {
      if (currentHandle && 'createWritable' in currentHandle) {
        // Direct save to existing file handle
        const writable = await currentHandle.createWritable();
        await writable.write(currentContent);
        await writable.close();
        setInitialContent(currentContent);
        return true;
      }

      // If showSaveFilePicker is available
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: currentFileName || 'Untitled.txt',
            types: [
              {
                description: 'Text Files',
                accept: {
                  'text/plain': ['.txt', '.md', '.json', '.js', '.ts', '.html', '.css', '.log'],
                },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(currentContent);
          await writable.close();

          setFileHandle(handle);
          setFileName(handle.name);
          setInitialContent(currentContent);
          return true;
        } catch (err: any) {
          // User cancelled save dialog
          if (err?.name === 'AbortError') {
            return false;
          }
          throw err;
        }
      }

      // Fallback: Download via blob
      const blob = new Blob([currentContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = currentFileName || 'Untitled.txt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setInitialContent(currentContent);
      return true;
    } catch (error) {
      console.error('Error saving file:', error);
      return false;
    }
  };

  // Execute pending action after resolving unsaved changes dialog
  const executePendingAction = (action: 'new' | 'open' | null) => {
    if (action === 'new') {
      setContent('');
      setInitialContent('');
      setFileName('Untitled.txt');
      setFileHandle(null);
      if (editorRef.current) {
        editorRef.current.focus();
      }
    } else if (action === 'open') {
      triggerOpenFileDialog();
    }
  };

  // Perform Open File dialog logic
  const triggerOpenFileDialog = async () => {
    try {
      if (window.showOpenFilePicker) {
        try {
          const [handle] = await window.showOpenFilePicker({
            types: [
              {
                description: 'Text Files',
                accept: {
                  'text/plain': ['.txt', '.md', '.json', '.js', '.ts', '.html', '.css', '.log', '*'],
                },
              },
            ],
            multiple: false,
          });
          const file = await handle.getFile();
          const text = await file.text();

          setFileHandle(handle);
          setFileName(handle.name);
          setContent(text);
          setInitialContent(text);
          if (editorRef.current) {
            editorRef.current.focus();
          }
          return;
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            return;
          }
          // Fall through to file input fallback on unexpected error
        }
      }

      // Fallback to hidden file input
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    } catch (error) {
      console.error('Error opening file:', error);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = (event.target?.result as string) || '';
        setFileHandle(null);
        setFileName(file.name);
        setContent(text);
        setInitialContent(text);
        if (editorRef.current) {
          editorRef.current.focus();
        }
      };
      reader.readAsText(file);
    }
    // Reset file input so re-selecting same file works
    e.target.value = '';
  };

  // Request handlers for New & Open
  const handleNewRequest = useCallback(() => {
    if (stateRef.current.isDirty) {
      setPendingAction('new');
      setShowUnsavedModal(true);
    } else {
      executePendingAction('new');
    }
  }, []);

  const handleOpenRequest = useCallback(() => {
    if (stateRef.current.isDirty) {
      setPendingAction('open');
      setShowUnsavedModal(true);
    } else {
      triggerOpenFileDialog();
    }
  }, []);

  const handleSaveRequest = useCallback(async () => {
    await performSave();
  }, []);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      // Handle Modal Keybinds when open
      if (stateRef.current.showUnsavedModal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowUnsavedModal(false);
          setPendingAction(null);
        }
        return;
      }

      if (!isCmdOrCtrl) return;

      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        handleSaveRequest();
      } else if (key === 'o') {
        e.preventDefault();
        handleOpenRequest();
      } else if (key === 'n') {
        e.preventDefault();
        handleNewRequest();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveRequest, handleOpenRequest, handleNewRequest]);

  // Modal actions
  const handleModalSave = async () => {
    const success = await performSave();
    if (success) {
      setShowUnsavedModal(false);
      const action = pendingAction;
      setPendingAction(null);
      executePendingAction(action);
    }
  };

  const handleModalDontSave = () => {
    setShowUnsavedModal(false);
    const action = pendingAction;
    setPendingAction(null);
    executePendingAction(action);
  };

  const handleModalCancel = () => {
    setShowUnsavedModal(false);
    setPendingAction(null);
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-white border border-[#d9d9d9] box-border relative select-none flex flex-col">
      {/* Hidden file input fallback */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        className="hidden"
        accept=".txt,.md,.json,.js,.ts,.html,.css,.log,text/*"
      />

      {/* Editor Canvas - Full Bleed */}
      <main className="flex-1 w-full h-full relative overflow-hidden bg-white">
        <Editor
          height="100%"
          width="100%"
          defaultLanguage="plaintext"
          language="plaintext"
          value={content}
          onChange={(val) => setContent(val || '')}
          onMount={handleEditorDidMount}
          options={{
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            fontSize: 14,
            lineHeight: 22,
            wordWrap: 'on',
            lineNumbers: 'off',
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 12,
            lineNumbersMinChars: 0,
            minimap: { enabled: false },
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
              useShadows: false,
            },
            overviewRulerBorder: false,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            renderLineHighlight: 'none',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 12, bottom: 12 },
            quickSuggestions: false,
            snippetSuggestions: 'none',
            suggestOnTriggerCharacters: false,
            wordBasedSuggestions: 'off',
            matchBrackets: 'never',
            renderValidationDecorations: 'off',
            contextmenu: false,
          }}
        />
      </main>

      {/* Instant Minimalist Unsaved Changes Dialog */}
      {showUnsavedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="w-[380px] bg-white border border-[#d9d9d9] shadow-lg p-5 font-['Inter',sans-serif] text-gray-800 flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 tracking-tight">
                Save changes?
              </h2>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                Do you want to save changes to <span className="font-medium text-gray-900">{fileName}</span>?
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                id="modal-save-btn"
                onClick={handleModalSave}
                className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white hover:bg-gray-800 active:bg-black transition-none cursor-pointer rounded-sm"
              >
                Save
              </button>
              <button
                id="modal-dontsave-btn"
                onClick={handleModalDontSave}
                className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-800 border border-gray-300 hover:bg-gray-200 active:bg-gray-300 transition-none cursor-pointer rounded-sm"
              >
                Don't Save
              </button>
              <button
                id="modal-cancel-btn"
                onClick={handleModalCancel}
                className="px-3 py-1.5 text-xs font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-none cursor-pointer rounded-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
