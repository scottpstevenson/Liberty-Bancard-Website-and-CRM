import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useVoiceRecorder, useVoiceStream } from "@/replit_integrations/audio";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Mic, Square, Loader2, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function Chat() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Audio hooks
  const recorder = useVoiceRecorder();
  const stream = useVoiceStream({
    onUserTranscript: (text) => {
      setMessages(prev => [...prev, { role: "user", content: text }]);
    },
    onTranscript: (_, full) => {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant") {
          return [...prev.slice(0, -1), { role: "assistant", content: full }];
        }
        return [...prev, { role: "assistant", content: full }];
      });
    },
    onComplete: () => {
      // Could re-fetch chat history here to sync IDs
    }
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleMicClick = async () => {
    if (recorder.state === "recording") {
      const blob = await recorder.stopRecording();
      // Assume conversation ID 1 for MVP demo, or fetch/create one
      await stream.streamVoiceResponse(`/api/conversations/1/messages`, blob);
    } else {
      await recorder.startRecording();
    }
  };

  // Basic text fallback (mock implementation since voice stream is primary)
  const handleSendText = () => {
    if (!inputValue.trim()) return;
    setMessages(prev => [...prev, { role: "user", content: inputValue }]);
    setInputValue("");
    // In real app, would hit text endpoint here
    setTimeout(() => {
      setMessages(prev => [...prev, { role: "assistant", content: "I'm currently optimized for voice interaction. Please use the microphone button!" }]);
    }, 1000);
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-primary">AI Business Advisor</h2>
        <p className="text-muted-foreground">Voice-enabled assistant for instant insights.</p>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden shadow-lg border-border">
        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground opacity-50">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Mic className="w-8 h-8 text-primary" />
              </div>
              <p>Start speaking or typing to get help.</p>
            </div>
          )}
          
          {messages.map((msg, i) => (
            <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[80%] rounded-2xl px-5 py-3 shadow-sm",
                msg.role === "user" 
                  ? "bg-primary text-white rounded-br-none" 
                  : "bg-white text-foreground border border-border rounded-bl-none"
              )}>
                {msg.content}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-border flex items-center gap-3">
          <Input 
            value={inputValue} 
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
            className="flex-1"
          />
          
          <Button 
            onClick={handleMicClick} 
            size="icon"
            className={cn(
              "h-10 w-10 rounded-full transition-all duration-300",
              recorder.state === "recording" ? "bg-red-500 hover:bg-red-600 animate-pulse" : "bg-accent hover:bg-accent/90"
            )}
          >
            {recorder.state === "recording" ? (
              <Square className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </Button>

          <Button 
            onClick={handleSendText} 
            size="icon" 
            variant="outline"
            className="h-10 w-10 rounded-full"
            disabled={!inputValue.trim()}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
