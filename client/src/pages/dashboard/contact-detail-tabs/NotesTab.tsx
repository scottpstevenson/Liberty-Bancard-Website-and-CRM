import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Edit2, Save, X, Pin, PinOff } from "lucide-react";
import type { Note } from "@shared/schema";
import { formatRelativeTime } from "./shared";

interface NotesTabProps {
  sortedNotes: Note[];
  noteContent: string;
  setNoteContent: (v: string) => void;
  addNote: () => void;
  // #243 — inline note editing; optional so callers that don't support it still work
  onUpdateNote?: (noteId: number, content: string) => Promise<void>;
  // #1475 — pin toggle support
  onPinNote?: (noteId: number, pinned: boolean) => Promise<void>;
}

const NOTES_PAGE_SIZE = 10;

export function NotesTab({ sortedNotes, noteContent, setNoteContent, addNote, onUpdateNote, onPinNote }: NotesTabProps) {
  // #268 — pagination
  const [notesPage, setNotesPage] = useState(1);

  // #1475 — sort pinned notes first, then by date
  const sortedWithPinned = useMemo(() => {
    return [...sortedNotes].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });
  }, [sortedNotes]);

  const pagedNotes = useMemo(
    () => sortedWithPinned.slice(0, notesPage * NOTES_PAGE_SIZE),
    [sortedWithPinned, notesPage]
  );
  const hasMore = pagedNotes.length < sortedWithPinned.length;

  // #243 — inline editing state per note
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [togglingPin, setTogglingPin] = useState<number | null>(null);

  const startEdit = (note: Note) => {
    setEditingId(note.id!);
    setEditContent(note.content || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const saveEdit = async (noteId: number) => {
    if (!onUpdateNote || !editContent.trim()) return;
    setSaving(true);
    try {
      await onUpdateNote(noteId, editContent.trim());
      setEditingId(null);
      setEditContent("");
    } finally {
      setSaving(false);
    }
  };

  const togglePin = async (note: Note) => {
    if (!onPinNote) return;
    setTogglingPin(note.id!);
    try {
      await onPinNote(note.id!, !note.pinned);
    } finally {
      setTogglingPin(null);
    }
  };

  return (
    <>
      <Card className="mb-4">
        <CardContent className="pt-4 pb-4">
          <div className="space-y-2">
            <Textarea
              value={noteContent}
              onChange={e => setNoteContent(e.target.value)}
              placeholder="Write a note..."
              rows={3}
              data-testid="textarea-add-note"
            />
            <Button onClick={addNote} disabled={!noteContent.trim()} data-testid="button-submit-note">
              <Plus className="h-4 w-4 mr-1" /> Add Note
            </Button>
          </div>
        </CardContent>
      </Card>

      {sortedWithPinned.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">No notes yet</p>
      ) : (
        <div className="space-y-3">
          {pagedNotes.map(note => (
            <Card
              key={note.id}
              data-testid={`card-note-${note.id}`}
              className={note.pinned ? "border-yellow-400/60 bg-yellow-50/30 dark:bg-yellow-950/10" : ""}
            >
              <CardContent className="py-4">
                {editingId === note.id ? (
                  // #243 — inline edit mode
                  <div className="space-y-2">
                    <Textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      rows={3}
                      autoFocus
                      data-testid={`textarea-edit-note-${note.id}`}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => saveEdit(note.id!)}
                        disabled={saving || !editContent.trim()}
                        data-testid={`button-save-note-${note.id}`}
                      >
                        <Save className="h-3 w-3 mr-1" /> {saving ? "Saving…" : "Save"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEdit} data-testid={`button-cancel-note-${note.id}`}>
                        <X className="h-3 w-3 mr-1" /> Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {note.pinned && (
                      <div className="flex items-center gap-1 text-[10px] text-yellow-600 dark:text-yellow-400 font-medium mb-1">
                        <Pin className="h-3 w-3" /> Pinned
                      </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap" data-testid={`text-note-content-${note.id}`}>
                      {note.content}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                      {note.authorName && (
                        <span data-testid={`text-note-author-${note.id}`}>{note.authorName}</span>
                      )}
                      <span data-testid={`text-note-time-${note.id}`}>
                        {formatRelativeTime(note.createdAt!)}
                      </span>
                      <div className="ml-auto flex items-center gap-1">
                        {onPinNote && (
                          <button
                            onClick={() => togglePin(note)}
                            disabled={togglingPin === note.id}
                            className="flex items-center gap-0.5 hover:text-foreground transition-colors"
                            data-testid={`button-pin-note-${note.id}`}
                            title={note.pinned ? "Unpin note" : "Pin note"}
                          >
                            {note.pinned
                              ? <PinOff className="h-3 w-3" />
                              : <Pin className="h-3 w-3" />}
                          </button>
                        )}
                        {onUpdateNote && (
                          <button
                            onClick={() => startEdit(note)}
                            className="flex items-center gap-0.5 hover:text-foreground transition-colors"
                            data-testid={`button-edit-note-${note.id}`}
                            title="Edit note"
                          >
                            <Edit2 className="h-3 w-3" /> Edit
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNotesPage(p => p + 1)}
                data-testid="button-load-more-notes"
              >
                Load more ({sortedWithPinned.length - pagedNotes.length} remaining)
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
