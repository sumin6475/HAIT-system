import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

interface MessageInputProps {
  onSend: (message: string) => void;
  // Reports typing changes for the typing indicator: true when typing starts, false when it stops or the message is sent.
  onTyping?: (isTyping: boolean) => void;
  disabled?: boolean;
}

const TYPING_IDLE_MS = 1500; // typing counts as stopped after this long without input

export const MessageInput = ({ onSend, onTyping, disabled }: MessageInputProps) => {
  const [value, setValue] = useState("");
  const isTypingRef = useRef(false); // avoids repeat events; only changes are reported
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();
  const composingRef = useRef(false); // whether an IME (Korean, Japanese, Chinese input) is composing, so the Enter that confirms a character is not taken as send

  // The typing state changes in one place only, so true or false is never sent twice in a row.
  const setTyping = (next: boolean) => {
    if (isTypingRef.current === next) return;
    isTypingRef.current = next;
    onTyping?.(next);
  };

  // Input happened: typing on, and the idle timer restarts.
  const handleChange = (next: string) => {
    setValue(next);
    if (next.trim()) {
      setTyping(true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setTyping(false), TYPING_IDLE_MS);
    } else {
      // An empty box clears typing at once.
      if (idleTimer.current) clearTimeout(idleTimer.current);
      setTyping(false);
    }
  };

  // On unmount: clear the timer and turn typing off, so no indicator is left on the other screen.
  useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      setTyping(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = () => {
    if (value.trim() && !disabled) {
      onSend(value.trim());
      setValue("");
      if (idleTimer.current) clearTimeout(idleTimer.current);
      setTyping(false); // typing ends once the message is sent
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // While an IME is composing, Enter confirms the character; it does not send.
      // (Sending mid-composition would send the text and then the confirmed last character again.)
      if (composingRef.current || e.nativeEvent.isComposing) return;
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-center gap-2 p-4 border-t bg-card">
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onCompositionStart={() => (composingRef.current = true)}
        onCompositionEnd={() => (composingRef.current = false)}
        onKeyDown={handleKeyDown}
        placeholder="Type your message..."
        disabled={disabled}
        className="flex-1 rounded-full border border-input bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      />
      <Button
        onClick={handleSend}
        disabled={!value.trim() || disabled}
        size="icon"
        className="rounded-full shrink-0"
      >
        <Send className="w-4 h-4" />
      </Button>
    </div>
  );
};
