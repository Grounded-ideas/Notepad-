import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { Minus, Square, X } from 'lucide-react';

// Tauri API module types
type TauriWindowModule = typeof import('@tauri-apps/api/window');
type TauriDialogModule = typeof import('@tauri-apps/api/dialog');
type TauriFsModule = typeof import('@tauri-apps/api/fs');

let tauriWindow: TauriWindowModule | null = null;
let tauriDialog: TauriDialogModule | null = null;
let tauriFs: TauriFsModule | null = null;

// Dynamically import Tauri APIs if running inside Tauri webview
if (typeof window !== 'undefined' && '__TAURI__' in window) {
  import('@tauri-apps/api/window').then(m => { tauriWindow = m; }).catch(() => {});
  import('@tauri-apps/api/dialog').then(m => { tauriDialog = m; }).catch(() => {});
  import('@tauri-apps/api/fs').then(m => { tauriFs = m; }).catch(() => {});
}

// TypeScript interfaces for File System Access API (Browser Fallback)
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
    __TAURI__?: object;
  }
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
}

export default function App() {
  const [content, setContent] = useState<string>('');
  const [initialContent, setInitialContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('Untitled.txt');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);

  // Dialog & Menu states
  const [showUnsavedModal, setShowUnsavedModal] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<'new' | 'open' | 'close' | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 });

  // Hidden file input fallback for standard web browser
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const isDirty = content !== initialContent;

  // Ref state for shortcuts and handlers
  const stateRef = useRef({
    content,
    initialContent,
    isDirty,
    filePath,
    fileHandle,
    fileName,
    showUnsavedModal,
  });

  useEffect(() => {
    stateRef.current = {
      content,
      initialContent,
      isDirty,
      filePath,
      fileHandle,
      fileName,
      showUnsavedModal,
    };
  }, [content, initialContent, isDirty, filePath, fileHandle, fileName, showUnsavedModal]);

  // Handle Monaco Mount
  const handleEditorDidMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor;

    // Define WinUI 3 Fluent light theme
    monacoInstance.editor.defineTheme('winui3-fluent', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: '', foreground: '1a1a1a' },
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#1a1a1a',
        'editorCursor.foreground': '#0f6cbd',
        'editor.lineHighlightBackground': '#00000000',
        'editor.selectionBackground': '#cbe6ff',
        'editor.inactiveSelectionBackground': '#e5edf6',
      },
    });

    monacoInstance.editor.setTheme('winui3-fluent');
    editor.focus();
  };

  // Close Context Menu on click outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu.visible) {
        setContextMenu({ visible: false, x: 0, y: 0 });
      }
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [contextMenu.visible]);

  // Perform Save action (Save / Save As)
  const performSave = async (forceSaveAs: boolean = false): Promise<boolean> => {
    const currentContent = stateRef.current.content;
    const currentPath = stateRef.current.filePath;
    const currentHandle = stateRef.current.fileHandle;
    const currentFileName = stateRef.current.fileName;

    try {
      // 1. Tauri Native File Save
      if (tauriFs && tauriDialog) {
        let targetPath: string | null = currentPath;
        if (!targetPath || forceSaveAs) {
          const selected = await tauriDialog.save({
            defaultPath: currentFileName || 'Untitled.txt',
            filters: [{ name: 'Text Documents', extensions: ['txt', 'md', 'json', 'js', 'ts', 'html', 'css', 'log', '*'] }]
          });
          if (!selected) return false;
          targetPath = selected;
        }

        if (targetPath) {
          await tauriFs.writeTextFile(targetPath, currentContent);
          const nameOnly = targetPath.split(/[/\\]/).pop() || 'Untitled.txt';
          setFilePath(targetPath);
          setFileName(nameOnly);
          setInitialContent(currentContent);
          return true;
        }
      }

      // 2. Web File System Access API
      if (!forceSaveAs && currentHandle && 'createWritable' in currentHandle) {
        const writable = await currentHandle.createWritable();
        await writable.write(currentContent);
        await writable.close();
        setInitialContent(currentContent);
        return true;
      }

      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: currentFileName || 'Untitled.txt',
            types: [
              {
                description: 'Text Documents',
                accept: { 'text/plain': ['.txt', '.md', '.json', '.js', '.ts', '.html', '.css', '.log'] },
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
          if (err?.name === 'AbortError') return false;
          throw err;
        }
      }

      // 3. Fallback: Browser Download
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

  // Execute pending action after unsaved modal decision
  const executePendingAction = (action: 'new' | 'open' | 'close' | null) => {
    if (action === 'new') {
      setContent('');
      setInitialContent('');
      setFileName('Untitled.txt');
      setFilePath(null);
      setFileHandle(null);
      if (editorRef.current) editorRef.current.focus();
    } else if (action === 'open') {
      triggerOpenFileDialog();
    } else if (action === 'close') {
      if (tauriWindow) {
        tauriWindow.appWindow.close();
      }
    }
  };

  // Open File logic
  const triggerOpenFileDialog = async () => {
    try {
      // 1. Tauri Native Open File Dialog
      if (tauriDialog && tauriFs) {
        const selected = await tauriDialog.open({
          multiple: false,
          filters: [{ name: 'Text Documents', extensions: ['txt', 'md', 'json', 'js', 'ts', 'html', 'css', 'log', '*'] }]
        });
        if (!selected || Array.isArray(selected)) return;

        const text = await tauriFs.readTextFile(selected);
        const nameOnly = selected.split(/[/\\]/).pop() || 'Untitled.txt';

        setFilePath(selected);
        setFileName(nameOnly);
        setContent(text);
        setInitialContent(text);
        if (editorRef.current) editorRef.current.focus();
        return;
      }

      // 2. Web File System Access API
      if (window.showOpenFilePicker) {
        try {
          const [handle] = await window.showOpenFilePicker({
            types: [
              {
                description: 'Text Files',
                accept: { 'text/plain': ['.txt', '.md', '.json', '.js', '.ts', '.html', '.css', '.log', '*'] },
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
          if (editorRef.current) editorRef.current.focus();
          return;
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
        }
      }

      // 3. Fallback file input
      if (fileInputRef.current) fileInputRef.current.click();
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
        setFilePath(null);
        setFileHandle(null);
        setFileName(file.name);
        setContent(text);
        setInitialContent(text);
        if (editorRef.current) editorRef.current.focus();
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  // Actions
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
    await performSave(false);
  }, []);

  const handleSaveAsRequest = useCallback(async () => {
    await performSave(true);
  }, []);

  const handleWindowCloseRequest = useCallback(() => {
    if (stateRef.current.isDirty) {
      setPendingAction('close');
      setShowUnsavedModal(true);
    } else if (tauriWindow) {
      tauriWindow.appWindow.close();
    }
  }, []);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

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
        if (e.shiftKey) {
          handleSaveAsRequest();
        } else {
          handleSaveRequest();
        }
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
  }, [handleSaveRequest, handleSaveAsRequest, handleOpenRequest, handleNewRequest]);

  // Context Menu Handler
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
    });
  };

  // Copy / Paste Handlers
  const handleCopy = () => {
    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand('copy');
    }
    setContextMenu({ visible: false, x: 0, y: 0 });
  };

  const handlePaste = async () => {
    if (editorRef.current) {
      editorRef.current.focus();
      try {
        const text = await navigator.clipboard.readText();
        const selection = editorRef.current.getSelection();
        if (selection) {
          editorRef.current.executeEdits('context-menu-paste', [
            { range: selection, text, forceMoveMarkers: true },
          ]);
        }
      } catch {
        document.execCommand('paste');
      }
    }
    setContextMenu({ visible: false, x: 0, y: 0 });
  };

  // Modal actions
  const handleModalSave = async () => {
    const success = await performSave(false);
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
    if (editorRef.current) editorRef.current.focus();
  };

  // Tauri Window Controls
  const handleMinimize = () => tauriWindow?.appWindow.minimize();
  const handleMaximize = () => tauriWindow?.appWindow.toggleMaximize();

  return (
    <div className="h-screen w-screen overflow-hidden bg-white border border-[#E5E5E5] box-border relative select-none flex flex-col font-['Inter',sans-serif]">
      {/* Hidden file input fallback */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        className="hidden"
        accept=".txt,.md,.json,.js,.ts,.html,.css,.log,text/*"
      />

      {/* CUSTOM WINUI 3 / FLUENT DRAGGABLE TITLEBAR */}
      <header
        data-tauri-drag-region
        className="h-8 w-full bg-[#f3f3f3] border-b border-[#E5E5E5] flex items-center justify-between select-none z-40 text-xs text-gray-700 shrink-0"
      >
        {/* TOP-LEFT: ONLY Current Filename & Unsaved Indicator (NO app name branding) */}
        <div data-tauri-drag-region className="flex items-center px-3 gap-1.5 font-medium tracking-tight text-gray-800 pointer-events-none">
          <span>{fileName}</span>
          {isDirty && <span className="text-gray-400 font-bold">*</span>}
        </div>

        {/* TOP-RIGHT: WINUI 3 WINDOW CONTROLS */}
        <div className="flex items-center h-full">
          <button
            onClick={handleMinimize}
            title="Minimize"
            className="h-full w-11 flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 text-gray-600 transition-colors cursor-default"
          >
            <Minus size={13} strokeWidth={1.75} />
          </button>
          <button
            onClick={handleMaximize}
            title="Maximize"
            className="h-full w-11 flex items-center justify-center hover:bg-gray-200 active:bg-gray-300 text-gray-600 transition-colors cursor-default"
          >
            <Square size={11} strokeWidth={1.75} />
          </button>
          <button
            onClick={handleWindowCloseRequest}
            title="Close"
            className="h-full w-12 flex items-center justify-center hover:bg-[#c42b1c] hover:text-white active:bg-[#b82213] text-gray-600 transition-colors cursor-default"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* EDITOR CANVAS - FULL BLEED WITH RIGHT CLICK CONTEXT MENU FLYOUT */}
      <main
        onContextMenu={handleContextMenu}
        className="flex-1 w-full h-full relative overflow-hidden bg-white"
      >
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

      {/* WINUI 3 / FLUENT FLYOUT RIGHT-CLICK CONTEXT MENU */}
      {contextMenu.visible && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-48 bg-white/95 backdrop-blur-md border border-[#E5E5E5] rounded-md shadow-xl p-1 text-xs text-gray-800 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-75"
        >
          <button
            onClick={() => { setContextMenu({ visible: false, x: 0, y: 0 }); handleNewRequest(); }}
            className="w-full text-left px-3 py-1.5 rounded-sm hover:bg-gray-100/80 active:bg-gray-200/80 flex items-center justify-between cursor-pointer"
          >
            <span>New</span>
            <span className="text-[10px] text-gray-400">Ctrl+N</span>
          </button>
          <button
            onClick={() => { setContextMenu({ visible: false, x: 0, y: 0 }); handleOpenRequest(); }}
            className="w-full text-left px-3 py-1.5 rounded-sm hover:bg-gray-100/80 active:bg-gray-200/80 flex items-center justify-between cursor-pointer"
          >
            <span>Open...</span>
            <span className="text-[10px] text-gray-400">Ctrl+O</span>
          </button>
          <button
            onClick={() => { setContextMenu({ visible: false, x: 0, y: 0 }); handleSaveRequest(); }}
            className="w-full text-left px-3 py-1.5 rounded-sm hover:bg-gray-100/80 active:bg-gray-200/80 flex items-center justify-between cursor-pointer"
          >
            <span>Save</span>
            <span className="text-[10px] text-gray-400">Ctrl+S</span>
          </button>
          <button
            onClick={() => { setContextMenu({ visible: false, x: 0, y: 0 }); handleSaveAsRequest(); }}
            className="w-full text-left px-3 py-1.5 rounded-sm hover:bg-gray-100/80 active:bg-gray-200/80 flex items-center justify-between cursor-pointer"
          >
            <span>Save As...</span>
            <span className="text-[10px] text-gray-400">Ctrl+Shift+S</span>
          </button>

          <div className="my-1 border-t border-gray-100" />

          <button
            onClick={handleCopy}
            className="w-full text-left px-3 py-1.5 rounded-sm hover:bg-gray-100/80 active:bg-gray-200/80 flex items-center justify-between cursor-pointer"
          >
            <span>Copy</span>
            <span className="text-[10px] text-gray-400">Ctrl+C</span>
          </button>
          <button
            onClick={handlePaste}
            className="w-full text-left px-3 py-1.5 rounded-sm hover:bg-gray-100/80 active:bg-gray-200/80 flex items-center justify-between cursor-pointer"
          >
            <span>Paste</span>
            <span className="text-[10px] text-gray-400">Ctrl+V</span>
          </button>
        </div>
      )}

      {/* WINUI 3 / FLUENT STYLE UNSAVED CHANGES CONFIRMATION DIALOG */}
      {showUnsavedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[1px]">
          <div className="w-[360px] bg-white border border-[#E5E5E5] rounded-lg shadow-2xl p-5 font-['Inter',sans-serif] text-gray-800 flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 tracking-tight">
                Save changes to {fileName}?
              </h2>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                There are unsaved edits in this file. Would you like to save them before continuing?
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                id="modal-save-btn"
                onClick={handleModalSave}
                className="px-4 py-1.5 text-xs font-medium bg-[#0f6cbd] text-white hover:bg-[#115ea3] active:bg-[#0c3b5e] transition-colors cursor-pointer rounded-md shadow-sm"
              >
                Save
              </button>
              <button
                id="modal-dontsave-btn"
                onClick={handleModalDontSave}
                className="px-4 py-1.5 text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200 hover:bg-gray-200 active:bg-gray-300 transition-colors cursor-pointer rounded-md"
              >
                Don't Save
              </button>
              <button
                id="modal-cancel-btn"
                onClick={handleModalCancel}
                className="px-4 py-1.5 text-xs font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer rounded-md"
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
