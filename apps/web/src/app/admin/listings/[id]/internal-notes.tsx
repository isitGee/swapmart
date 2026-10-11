'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert, Panel } from '@/components/ui/feedback';
import { Checkbox, Field, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';

export function InternalNotes({
  listingId,
  notes,
}: {
  listingId: string;
  notes: { id: string; body: string; author: string; createdAt: string }[];
}) {
  const [body, setBody] = useState('');
  const [userVisible, setUserVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function add() {
    if (body.trim().length < 2) {
      setError('Write the note before saving.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiPost('/admin/notes', {
        entityType: 'listing',
        entityId: listingId,
        body: body.trim(),
        visibility: userVisible ? 'user_visible' : 'moderator_note',
      });
      setBody('');
      setUserVisible(false);
      toast.success('Note saved.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel title="Internal notes" description="Cross-reviewer context for this device. Notes are never deleted.">
      {notes.length === 0 ? (
        <p className="text-sm text-ink-600">No notes on this submission yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-control border border-line bg-surface-muted p-3">
              <p className="text-sm text-ink-700">{note.body}</p>
              <p className="mt-1 text-xs text-ink-500">
                {note.author} · {formatDateTime(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-line pt-4">
        <Field label="Add a note" htmlFor="internal-note" hint="Visible to administrators">
          <Textarea
            id="internal-note"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="e.g. Identifier matches the receipt dated March; seller's other listings are consistent."
          />
        </Field>
        <Checkbox
          id="user-visible-note"
          className="mt-3"
          checked={userVisible}
          onChange={(event) => setUserVisible(event.target.checked)}
          label="Also show this note to the seller"
          description="Leave unchecked to keep the note internal to the moderation team."
        />
        {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" size="sm" icon="plus" onClick={add} loading={pending}>
            Save note
          </Button>
        </div>
      </div>
    </Panel>
  );
}
