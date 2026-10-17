import { afterEach, describe, expect, it } from 'vitest';
import { FolderLibrary, SETTLE_MS, folderEntryId, folderIdsIn, isFolderId, matchEntry, sortEntries } from './folders';
import { describeProject, sourceAnalysisSummary } from './ai/describe';
import { createProject } from './model';
import type { MediaAnalysis } from './analysisStore';

/* An in-memory stand-in for the File System Access API (a folder the user picked). */
type Node = { file: File } | { dir: Record<string, Node> };

function fakeDir(name: string, tree: Record<string, Node>): FileSystemDirectoryHandle {
  const handle = {
    kind: 'directory' as const,
    name,
    async *values() {
      for (const [n, node] of Object.entries(tree)) {
        if ('dir' in node) yield fakeDir(n, node.dir);
        else yield { kind: 'file' as const, name: n, getFile: async () => node.file };
      }
    },
    isSameEntry: async (other: unknown) => other === handle,
    queryPermission: async () => 'granted' as const,
    requestPermission: async () => 'granted' as const,
  };
  return handle as unknown as FileSystemDirectoryHandle;
}

const old = Date.now() - 60_000;
const file = (name: string, bytes = 10, lastModified = old) => ({ file: new File([new Uint8Array(bytes)], name, { lastModified }) });

describe('folder ids', () => {
  it('are stable, ignore letter case and change when the file does', () => {
    const id = folderEntryId('Valorant', 'Clips/2026-10-16 21-03-11.mp4', 1000);
    expect(isFolderId(id)).toBe(true);
    expect(folderEntryId('valorant', 'clips/2026-10-16 21-03-11.MP4', 1000)).toBe(id);
    expect(folderEntryId('Valorant', 'Clips/2026-10-16 21-03-11.mp4', 1001)).not.toBe(id);
    expect(isFolderId('m_abc')).toBe(false);
  });

  it('are found anywhere in the AI actions', () => {
    const a = folderEntryId('V', 'a.mp4', 1);
    const b = folderEntryId('V', 'b.mp4', 1);
    const actions = [{ type: 'addClip', media: a }, { type: 'look', media: b, times: [1] }, { type: 'x', list: [{ deep: a }] }, { type: 'split', time: 2 }];
    expect(folderIdsIn(actions).sort()).toEqual([a, b].sort());
  });

  it('sort newest first and match missing files by name and size', () => {
    const list = [
      { path: 'b.mp4', name: 'b.mp4', lastModified: 1, size: 5 },
      { path: 'a.mp4', name: 'A.mp4', lastModified: 3, size: 7 },
      { path: 'c.mp4', name: 'c.mp4', lastModified: 3, size: 9 },
    ];
    expect(sortEntries(list).map((e) => e.path)).toEqual(['a.mp4', 'c.mp4', 'b.mp4']);
    expect(matchEntry(list, 'a.mp4', 7)?.path).toBe('a.mp4');
    expect(matchEntry(list, 'a.mp4', 8)).toBeUndefined();
  });
});

describe('FolderLibrary', () => {
  const g = globalThis as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
  afterEach(() => {
    delete g.showDirectoryPicker;
  });

  it('lists the media of a linked folder and its subfolders, newest first, and opens files from it', async () => {
    const root = fakeDir('Valorant', {
      'match1.mp4': file('match1.mp4', 100, old - 5000),
      'notes.txt': file('notes.txt'),
      '.hidden.mp4': file('.hidden.mp4'),
      'still recording.mp4': file('still recording.mp4', 50, Date.now() - SETTLE_MS / 2),
      Highlights: { dir: { 'ace.mkv': file('ace.mkv', 200, old), 'music.mp3': file('music.mp3', 30, old - 9000) } },
    });
    g.showDirectoryPicker = async () => root;
    const lib = new FolderLibrary();
    const folder = await lib.link();
    expect(folder?.name).toBe('Valorant');
    expect(lib.entries.map((e) => e.path)).toEqual(['Highlights/ace.mkv', 'match1.mp4', 'Highlights/music.mp3']);
    expect(lib.entries.map((e) => e.kind)).toEqual(['video', 'video', 'audio']);
    const ace = lib.entries[0];
    expect(ace.id).toBe(folderEntryId('Valorant', 'Highlights/ace.mkv', 200));
    expect((await lib.file(ace.id)).size).toBe(200);
    expect(lib.find('MATCH1.mp4', 100)?.path).toBe('match1.mp4');

    // linking the same folder again rescans it instead of adding it twice
    await lib.link();
    expect(lib.folders).toHaveLength(1);

    await lib.unlink(folder!.id);
    expect(lib.entries).toEqual([]);
    await expect(lib.file(ace.id)).rejects.toThrow(/no longer in the linked folder/);
  });

  it('returns null when the user cancels the folder picker', async () => {
    g.showDirectoryPicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
    expect(await new FolderLibrary().link()).toBeNull();
  });
});

describe('the AI and linked folders', () => {
  it('lists folder files with their fd_ ids for the AI', () => {
    const id = folderEntryId('Valorant', 'match1.mp4', 100);
    const text = describeProject(createProject(), {
      playhead: 0,
      selection: [],
      folders: { names: ['Valorant'], files: [{ id, path: 'match1.mp4', kind: 'video', lastModified: new Date(2026, 9, 16, 21, 3).getTime(), duration: 32.5, width: 1920, height: 1080 }], total: 3 },
    });
    expect(text).toContain('Linked folders ("Valorant") — 3 file(s) not in the project yet');
    expect(text).toContain(`- ${id} | video "match1.mp4" 1920×1080, 32.5 s | saved 2026-10-16 21:03`);
    expect(text).toContain('… and 2 older file(s).');
  });

  it('summarises a clip analysis in source seconds', () => {
    const a = {
      audio: {
        duration: 30,
        beats: null,
        hits: [],
        loud: [
          { time: 13.3, prominence: 14 },
          { time: 12.4, prominence: 18 },
        ],
        bursts: [{ start: 12.1, end: 13.4, count: 3 }],
        rises: [],
        envelope: { rate: 20, values: new Float32Array(0) },
      },
      scenes: null,
      analysedSeconds: 30,
    } as unknown as MediaAnalysis;
    const s = sourceAnalysisSummary(a);
    expect(s).toContain('loud moments (gunshots, kills, impacts): 12.40 (+18 dB), 13.30 (+14 dB)');
    expect(s).toContain('bursts: 12.10–13.40 (3 hits)');
    expect(sourceAnalysisSummary('pending')).toContain('still running');
  });
});
