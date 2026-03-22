/**
 * Types, constants, and interfaces for the file manager extension.
 */

/** Sentinel value used in placeholder files to distinguish empty from real content. */
export const SENTINEL = "<!-- PLACEHOLDER: managed by file-manager -->";

/** Subdirectories created under the root state directory. */
export const SUBDIRS = ["active", "archives", "config", "logs", "metadata", "templates"] as const;
export type SubdirName = (typeof SUBDIRS)[number];

/** Phase of the file manager, computed from filesystem state. */
export type Phase = "uninitialized" | "initialized" | "active" | "archived";

/** Archive filename date format. */
export type ArchiveDateFormat = "full" | "date-only";

/** Template analysis classification. */
export type TemplateClassification =
	| "explicit-placeholders"
	| "legacy-fallback"
	| "default-fallback"
	| "invalid";

/** Configuration for the file manager. */
export interface FileManagerConfig {
	/** Root directory relative to project root (e.g. ".pi/file-manager"). */
	rootDir: string;
	/** Content type label (e.g. "notes", "plans", "logs"). */
	contentType: string;
	/** Filename for the active content file (e.g. "current.md"). */
	activeFilename: string;
	/** Date format used in archive filenames. */
	archiveDateFormat: ArchiveDateFormat;
	/** Maximum entries returned by list operations. */
	maxListEntries: number;
	/** Log directory path relative to root. */
	logDir: string;
	/** Enable debug/verbose output. */
	debug: boolean;
}

/** Metadata stored alongside active content. */
export interface FileManagerMeta {
	/** Schema version for forward compatibility. */
	version: string;
	/** Human-readable title. */
	title: string;
	/** ISO 8601 creation timestamp. */
	createdAt: string;
	/** ISO 8601 last-update timestamp. */
	updatedAt: string;
	/** Arbitrary extension-specific fields. */
	custom: Record<string, unknown>;
}

/** A single archive entry. */
export interface ArchiveEntry {
	/** Archive filename (e.g. "2026-03-22-1430-my-doc.md"). */
	filename: string;
	/** Absolute path to the archive file. */
	path: string;
	/** Title extracted from the archived content. */
	title: string;
	/** Date string extracted from the filename. */
	date: string;
}

/** Aggregated state information, computed from filesystem. */
export interface StateInfo {
	/** Resolved absolute root path, or null if not detected. */
	root: string | null;
	/** Whether the directory structure is fully initialized. */
	initialized: boolean;
	/** Whether the active file contains real (non-sentinel) content. */
	hasActive: boolean;
	/** Current phase. */
	phase: Phase;
}

/** Read-only diagnostic snapshot. */
export interface DiagnosticSnapshot {
	/** ISO 8601 timestamp when the snapshot was taken. */
	timestamp: string;
	/** Current phase. */
	phase: Phase;
	/** Whether active content exists. */
	hasActiveContent: boolean;
	/** Number of archives. */
	archiveCount: number;
	/** Whether the config file is present. */
	configPresent: boolean;
	/** Whether the metadata file is present. */
	metadataPresent: boolean;
	/** Existence of each subdirectory. */
	subdirs: Record<SubdirName, boolean>;
	/** Active file size in bytes (0 if missing). */
	activeFileSize: number;
	/** Active file line count (0 if missing). */
	activeFileLines: number;
	/** Config source description. */
	configSource: string;
	/** Template analysis result. */
	templateAnalysis: TemplateClassification | null;
	/** Non-fatal errors encountered during snapshot. */
	errors: string[];
}

/** Result of an initialization operation. */
export interface InitResult {
	/** Paths that were created. */
	created: string[];
	/** Paths that were skipped (already existed). */
	skipped: string[];
}

/** Result of a safe write operation. */
export interface SafeWriteResult {
	/** Whether the write succeeded. */
	ok: boolean;
	/** Reason for failure, if any. */
	reason?: string;
}

/** Result of a migration operation. */
export interface MigrationResult {
	/** Whether legacy layout was detected. */
	isLegacy: boolean;
	/** Actions taken or detected. */
	actions: string[];
}
