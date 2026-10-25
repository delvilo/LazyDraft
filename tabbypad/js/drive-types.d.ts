import type {
    NoteId,
    Note,
    CloudSnapshot,
    NotebookState,
    RestorePlan
} from '../../js/tabbypad/backup-core.js';

declare global {
    interface StorageMutationEvent {
        type: string;
        revision: number;
    }

    interface StorageApplyResult {
        success: boolean;
        noOp?: boolean;
        checkpointId?: string;
        newRevision: number;
    }

    interface StorageUndoResult {
        success: boolean;
        restoredCount: number;
        newRevision: number;
    }

    interface StorageCheckpointRecord {
        checkpointId: string;
        createdAt: string;
        notes: Note[];
        noteCount: number;
    }

    interface TabbypadStorageAPI {
        getAllNotes(): Promise<Note[]>;
        getNoteById(id: NoteId): Promise<Note | null>;
        createNote(content: string, color?: string): Promise<Note>;
        updateNote(
            id: NoteId,
            newContent: string,
            options?: {
                expectedContent?: string;
                expectedRecord?: Note;
                color?: string;
            }
        ): Promise<Note>;
        deleteNote(id: NoteId, options?: { expectedRecord?: Note }): Promise<boolean>;
        captureNotebookState(): Promise<NotebookState>;
        applyRestore(
            plan: RestorePlan,
            guard: {
                expectedRevision: number;
                expectedCanonicalText: string;
                editorGuard?: () => boolean;
            }
        ): Promise<StorageApplyResult>;
        undoRestore(
            guard: {
                expectedCheckpointId: string;
                expectedRevision: number;
                expectedCanonicalText: string;
                editorGuard?: () => boolean;
            }
        ): Promise<StorageUndoResult>;
        getRecoveryCheckpoint(): Promise<StorageCheckpointRecord | null>;
        subscribe(callback: (event: StorageMutationEvent) => void): () => void;
        migrateNotesFromLocalStorage(): Promise<void>;
        migrateLegacySnapshots(): Promise<void>;
    }

    interface TabbypadEditorState {
        isOpen: boolean;
        noteId: NoteId | null;
        isDirty: boolean;
        revision: number;
        sessionId: number;
    }

    interface TabbypadEditorAPI {
        hasUnsavedChanges(): boolean;
        getEditorState(): TabbypadEditorState;
        getEditorGuard(): () => boolean;
        closeEditorIfClean(): boolean;
        saveCurrentNote(): Promise<boolean>;
        reloadNotes(): Promise<void>;
    }

    interface GoogleDriveUser {
        displayName: string;
        emailAddress: string;
        photoLink?: string;
    }

    interface GoogleTokenResponse {
        access_token?: string;
        expires_in?: string | number;
        scope?: string;
        token_type?: string;
        error?: string;
        error_description?: string;
        error_uri?: string;
    }

    interface GoogleTokenClient {
        requestAccessToken(overrideConfig?: { prompt?: string }): void;
    }

    interface GoogleTokenClientConfig {
        client_id: string;
        scope: string;
        include_granted_scopes?: boolean;
        prompt?: string;
        callback?: (response: GoogleTokenResponse) => void;
        error_callback?: (error: { type: string; message: string }) => void;
    }

    interface GoogleIdentityServices {
        accounts: {
            oauth2: {
                initTokenClient(config: GoogleTokenClientConfig): GoogleTokenClient;
                hasGrantedAllScopes(tokenResponse: GoogleTokenResponse, firstScope: string, ...restScopes: string[]): boolean;
            };
        };
    }

    interface JQueryModalOptions {
        backdrop?: boolean | 'static';
        keyboard?: boolean;
    }

    interface JQueryElement {
        modal(action?: 'show' | 'hide' | JQueryModalOptions): JQueryElement;
        is(selector: string): boolean;
        on(event: string, handler: (event?: unknown) => void): JQueryElement;
        one(event: string, handler: (event?: unknown) => void): JQueryElement;
    }

    interface Window {
        TabbypadStorage?: TabbypadStorageAPI;
        TabbypadEditor?: TabbypadEditorAPI;
        google?: GoogleIdentityServices;
    }

    function $(selector: string | HTMLElement | Window | Document): JQueryElement;
}

export {};
