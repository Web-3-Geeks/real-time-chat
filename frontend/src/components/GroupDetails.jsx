import { useState } from 'react';
import axiosInstance from '../api/axiosInstance';
import Avatar from './Avatar';

const smallButton =
  'px-2 py-1 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Group section of the chat "Details" panel: members (with admin badges and
 * online dots), and — for admins — rename, add/remove members and promote or
 * demote admins. Everyone can leave.
 *
 * Every action calls the REST API and hands the server's updated group back
 * through `onUpdated`; other members get the same update via the
 * `conversation_updated` socket event.
 */
function GroupDetails({
  conversation,
  currentUserId,
  onlineUserIds,
  allUsers,
  onUpdated,
  onLeaveStart,
  onLeft,
  onError,
}) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(conversation.name || '');
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState([]);
  const [busy, setBusy] = useState(false);

  const members = conversation.members || [];
  const admins = conversation.admins || [];
  const isAdmin = admins.includes(currentUserId);
  const memberIds = new Set(members.map((m) => m._id));
  const candidates = allUsers.filter((u) => u._id !== currentUserId && !memberIds.has(u._id));

  // Admins first, then alphabetical; "you" pinned to the top.
  const sortedMembers = [...members].sort((a, b) => {
    if (a._id === currentUserId) return -1;
    if (b._id === currentUserId) return 1;
    const adminDiff = Number(admins.includes(b._id)) - Number(admins.includes(a._id));
    return adminDiff || (a.name || '').localeCompare(b.name || '');
  });

  const run = async (request) => {
    setBusy(true);
    onError('');
    try {
      const { data } = await request();
      return data;
    } catch (err) {
      onError(err.response?.data?.message || 'Something went wrong. Please try again.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const base = `/conversations/${conversation._id}`;

  const saveName = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const data = await run(() => axiosInstance.patch(base, { name: newName.trim() }));
    if (data) {
      onUpdated(data);
      setRenaming(false);
    }
  };

  const addMembers = async () => {
    if (toAdd.length === 0) return;
    const data = await run(() => axiosInstance.post(`${base}/members`, { memberIds: toAdd }));
    if (data) {
      onUpdated(data);
      setToAdd([]);
      setAdding(false);
    }
  };

  const removeMember = async (member) => {
    if (!window.confirm(`Remove ${member.name} from the group?`)) return;
    const data = await run(() => axiosInstance.delete(`${base}/members/${member._id}`));
    if (data) onUpdated(data);
  };

  const setRole = async (member, role) => {
    const data = await run(() => axiosInstance.patch(`${base}/members/${member._id}`, { role }));
    if (data) onUpdated(data);
  };

  const leave = async () => {
    if (!window.confirm(`Leave "${conversation.name}"? You'll stop receiving its messages.`)) return;
    // Flag it first: the server's conversation_removed event can arrive
    // before this request resolves.
    onLeaveStart?.(conversation._id);
    const data = await run(() => axiosInstance.post(`${base}/leave`));
    if (data) onLeft(conversation._id);
  };

  return (
    <div className="flex flex-col">
      {isAdmin && (
        <div className="px-5 py-3 border-b border-line dark:border-line-dark">
          {renaming ? (
            <form onSubmit={saveName} className="flex flex-col gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                autoFocus
                aria-label="New group name"
                className="px-3 py-2 rounded-lg border border-line dark:border-line-dark bg-page dark:bg-page-dark text-ink dark:text-ink-dark text-sm outline-none focus:border-accent"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRenaming(false);
                    setNewName(conversation.name || '');
                  }}
                  className={`${smallButton} text-muted`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !newName.trim()}
                  className={`${smallButton} bg-accent text-white`}
                >
                  Save
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => {
                setNewName(conversation.name || '');
                setRenaming(true);
              }}
              className="w-full flex items-center gap-2 text-sm text-ink dark:text-ink-dark hover:text-accent"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
              Rename group
            </button>
          )}
        </div>
      )}

      <div className="px-3 py-3">
        <div className="flex items-center justify-between px-2 pb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Members ({members.length})
          </p>
          {isAdmin && candidates.length > 0 && (
            <button
              onClick={() => setAdding((v) => !v)}
              className={`${smallButton} ${
                adding ? 'text-muted' : 'bg-accent-soft dark:bg-accent-soft-dark text-accent'
              }`}
            >
              {adding ? 'Cancel' : '+ Add'}
            </button>
          )}
        </div>

        {adding && (
          <div className="mx-2 mb-3 p-2 rounded-xl border border-line dark:border-line-dark">
            <div className="max-h-40 overflow-y-auto scroll-thin">
              {candidates.map((u) => (
                <label
                  key={u._id}
                  className="flex items-center gap-2.5 text-sm text-ink dark:text-ink-dark px-1.5 py-1.5 rounded-lg hover:bg-nav-active dark:hover:bg-nav-active-dark cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={toAdd.includes(u._id)}
                    onChange={() =>
                      setToAdd((prev) =>
                        prev.includes(u._id) ? prev.filter((id) => id !== u._id) : [...prev, u._id]
                      )
                    }
                    className="accent-accent"
                  />
                  <Avatar name={u.name} src={u.avatar} size="w-7 h-7" textSize="text-[10px]" />
                  <span className="truncate">{u.name}</span>
                </label>
              ))}
            </div>
            <button
              onClick={addMembers}
              disabled={busy || toAdd.length === 0}
              className="mt-2 w-full py-1.5 rounded-lg bg-ink dark:bg-ink-dark text-white dark:text-ink text-xs font-semibold disabled:opacity-50"
            >
              Add {toAdd.length > 0 ? `${toAdd.length} member${toAdd.length === 1 ? '' : 's'}` : 'members'}
            </button>
          </div>
        )}

        {sortedMembers.map((m) => {
          const isMe = m._id === currentUserId;
          const memberIsAdmin = admins.includes(m._id);
          return (
            <div key={m._id} className="group flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-nav-active/60 dark:hover:bg-nav-active-dark/60">
              <Avatar
                name={m.name}
                src={m.avatar}
                size="w-8 h-8"
                textSize="text-[11px]"
                online={isMe ? true : onlineUserIds.has(m._id)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink dark:text-ink-dark truncate">
                  {m.name}
                  {isMe && <span className="text-muted"> (you)</span>}
                </p>
                {memberIsAdmin && <p className="text-[10px] font-semibold text-accent">Admin</p>}
              </div>
              {isAdmin && !isMe && (
                <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    onClick={() => setRole(m, memberIsAdmin ? 'member' : 'admin')}
                    disabled={busy}
                    title={memberIsAdmin ? 'Remove as admin' : 'Make admin'}
                    aria-label={memberIsAdmin ? `Remove ${m.name} as admin` : `Make ${m.name} admin`}
                    className={`${smallButton} text-muted hover:text-accent`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={memberIsAdmin ? 'currentColor' : 'none'} aria-hidden="true">
                      <path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6l-8-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    onClick={() => removeMember(m)}
                    disabled={busy}
                    title="Remove from group"
                    aria-label={`Remove ${m.name} from group`}
                    className={`${smallButton} text-muted hover:text-danger`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="9" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M2 21a7 7 0 0 1 14 0M16 11h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-5 py-4 mt-auto border-t border-line dark:border-line-dark">
        <button
          onClick={leave}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold text-danger hover:bg-danger-soft dark:hover:bg-danger/15 disabled:opacity-50"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Leave group
        </button>
      </div>
    </div>
  );
}

export default GroupDetails;
