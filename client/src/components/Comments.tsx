import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Comment } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MessageSquare,
  Reply,
  Trash2,
  Pin,
  PinOff,
  Send,
  ChevronDown,
  ChevronRight,
  AtSign,
} from "lucide-react";

interface CommentsProps {
  entityType: "contact" | "deal" | "ticket" | "task";
  entityId: number;
}

interface CommentTree extends Comment {
  children: CommentTree[];
}

function buildTree(comments: Comment[]): CommentTree[] {
  const map = new Map<number, CommentTree>();
  const roots: CommentTree[] = [];

  const sorted = [...comments].sort(
    (a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime()
  );

  sorted.forEach((c) => {
    map.set(c.id, { ...c, children: [] });
  });

  sorted.forEach((c) => {
    const node = map.get(c.id)!;
    if (c.parentId && map.has(c.parentId)) {
      map.get(c.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const pinned = roots.filter((c) => c.pinned);
  const unpinned = roots.filter((c) => !c.pinned);
  return [...pinned, ...unpinned];
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function MentionInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  testId: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [cursorPos, setCursorPos] = useState(0);

  const teamMembers = ["Admin", "Sales Rep", "Support Agent", "Manager", "Onboarding Specialist"];

  const filtered = teamMembers.filter((m) =>
    m.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart || 0;
    onChange(val);
    setCursorPos(pos);

    const textBefore = val.slice(0, pos);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setShowSuggestions(true);
      setMentionFilter(atMatch[1]);
    } else {
      setShowSuggestions(false);
    }
  };

  const insertMention = (member: string) => {
    const textBefore = value.slice(0, cursorPos);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      const start = cursorPos - atMatch[0].length;
      const newValue = value.slice(0, start) + `@${member} ` + value.slice(cursorPos);
      onChange(newValue);
    }
    setShowSuggestions(false);
    textareaRef.current?.focus();
  };

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="resize-none text-sm"
        rows={2}
        data-testid={testId}
      />
      {showSuggestions && filtered.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 bg-popover border rounded-md shadow-md z-50 w-56 max-h-40 overflow-y-auto" data-testid="mention-suggestions">
          {filtered.map((member) => (
            <button
              key={member}
              className="w-full text-left px-3 py-1.5 text-sm hover-elevate flex items-center gap-2"
              onClick={() => insertMention(member)}
              data-testid={`mention-option-${member.replace(/\s+/g, "-").toLowerCase()}`}
            >
              <AtSign className="w-3 h-3 text-muted-foreground" />
              {member}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentNode({
  comment,
  entityType,
  entityId,
  depth,
}: {
  comment: CommentTree;
  entityType: string;
  entityId: number;
  depth: number;
}) {
  const { toast } = useToast();
  const [showReply, setShowReply] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const qk = ["/api/comments", entityType, entityId];

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/comments", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      setReplyContent("");
      setShowReply(false);
    },
    onError: () => {
      toast({ title: "Failed to post reply", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/comments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "Comment deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete comment", variant: "destructive" });
    },
  });

  const pinMutation = useMutation({
    mutationFn: async ({ id, pinned }: { id: number; pinned: boolean }) => {
      const res = await apiRequest("PUT", `/api/comments/${id}`, { pinned });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
    },
    onError: () => {
      toast({ title: "Failed to update pin", variant: "destructive" });
    },
  });

  const handleReply = () => {
    if (!replyContent.trim()) return;
    const mentions = Array.from(replyContent.matchAll(/@([\w\s]+?)(?=\s|$)/g)).map((m) => m[1].trim());
    createMutation.mutate({
      entityType,
      entityId,
      parentId: comment.id,
      content: replyContent.trim(),
      mentions: mentions.length > 0 ? mentions : undefined,
    });
  };

  const renderContent = (content: string) => {
    const parts = content.split(/(@[\w\s]+?)(?=\s|$|@)/g);
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        return (
          <span key={i} className="text-primary font-medium">
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div
      className={depth > 0 ? "ml-6 border-l-2 border-muted pl-3" : ""}
      data-testid={`comment-${comment.id}`}
    >
      <div className="flex gap-2 py-2">
        <Avatar className="h-7 w-7 flex-shrink-0">
          <AvatarFallback className="text-xs">
            {getInitials(comment.authorName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium" data-testid={`comment-author-${comment.id}`}>
              {comment.authorName || "Unknown"}
            </span>
            <span className="text-xs text-muted-foreground" data-testid={`comment-time-${comment.id}`}>
              {comment.createdAt ? formatRelativeTime(String(comment.createdAt)) : ""}
            </span>
            {comment.pinned && (
              <Badge variant="outline" className="text-xs no-default-hover-elevate no-default-active-elevate" data-testid={`comment-pinned-${comment.id}`}>
                <Pin className="w-2.5 h-2.5 mr-0.5" /> Pinned
              </Badge>
            )}
          </div>
          <div className="text-sm mt-0.5" data-testid={`comment-content-${comment.id}`}>
            {renderContent(comment.content)}
          </div>
          <div className="flex items-center gap-1 mt-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs text-muted-foreground gap-1"
              onClick={() => setShowReply(!showReply)}
              data-testid={`button-reply-${comment.id}`}
            >
              <Reply className="w-3 h-3" /> Reply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs text-muted-foreground gap-1"
              onClick={() => pinMutation.mutate({ id: comment.id, pinned: !comment.pinned })}
              data-testid={`button-pin-${comment.id}`}
            >
              {comment.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
              {comment.pinned ? "Unpin" : "Pin"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs text-muted-foreground gap-1"
              onClick={() => deleteMutation.mutate(comment.id)}
              disabled={deleteMutation.isPending}
              data-testid={`button-delete-comment-${comment.id}`}
            >
              <Trash2 className="w-3 h-3" /> Delete
            </Button>
            {comment.children.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs text-muted-foreground gap-1"
                onClick={() => setCollapsed(!collapsed)}
                data-testid={`button-toggle-replies-${comment.id}`}
              >
                {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {comment.children.length} {comment.children.length === 1 ? "reply" : "replies"}
              </Button>
            )}
          </div>
          {showReply && (
            <div className="mt-2 flex gap-2" data-testid={`reply-form-${comment.id}`}>
              <MentionInput
                value={replyContent}
                onChange={setReplyContent}
                placeholder="Write a reply... Use @ to mention"
                testId={`input-reply-${comment.id}`}
              />
              <Button
                size="icon"
                onClick={handleReply}
                disabled={createMutation.isPending || !replyContent.trim()}
                data-testid={`button-submit-reply-${comment.id}`}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
      {!collapsed &&
        comment.children.map((child) => (
          <CommentNode
            key={child.id}
            comment={child}
            entityType={entityType}
            entityId={entityId}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

export default function Comments({ entityType, entityId }: CommentsProps) {
  const { toast } = useToast();
  const [newContent, setNewContent] = useState("");
  const qk = ["/api/comments", entityType, entityId];

  const { data: comments, isLoading } = useQuery<Comment[]>({
    queryKey: qk,
    queryFn: async () => {
      const res = await fetch(
        `/api/comments?entityType=${entityType}&entityId=${entityId}`,
        { credentials: "include" }
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!entityId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/comments", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      setNewContent("");
    },
    onError: () => {
      toast({ title: "Failed to post comment", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!newContent.trim()) return;
    const mentions = Array.from(newContent.matchAll(/@([\w\s]+?)(?=\s|$)/g)).map((m) => m[1].trim());
    createMutation.mutate({
      entityType,
      entityId,
      content: newContent.trim(),
      mentions: mentions.length > 0 ? mentions : undefined,
    });
  };

  const tree = buildTree(comments || []);

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="comments-loading">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="comments-section">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium" data-testid="text-comment-count">
          {(comments || []).length} {(comments || []).length === 1 ? "Comment" : "Comments"}
        </span>
      </div>

      <div className="flex gap-2" data-testid="comment-form">
        <div className="flex-1">
          <MentionInput
            value={newContent}
            onChange={setNewContent}
            placeholder="Add a comment... Use @ to mention team members"
            testId="input-new-comment"
          />
        </div>
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={createMutation.isPending || !newContent.trim()}
          data-testid="button-submit-comment"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>

      <div className="divide-y" data-testid="comments-list">
        {tree.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-comments">
            No comments yet. Be the first to add one.
          </p>
        )}
        {tree.map((comment) => (
          <CommentNode
            key={comment.id}
            comment={comment}
            entityType={entityType}
            entityId={entityId}
            depth={0}
          />
        ))}
      </div>
    </div>
  );
}
