import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { apiRequest } from "@/lib/queryClient"
import { useMutation } from "@tanstack/react-query"
import { Sparkles, Copy, Send, Loader2, Mail } from "lucide-react"

interface EmailComposerProps {
  contactId?: number
  prospectId?: number
  onClose: () => void
  open: boolean
}

export function EmailComposer({ contactId, prospectId, onClose, open }: EmailComposerProps) {
  const [context, setContext] = useState("")
  const [tone, setTone] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const { toast } = useToast()

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/compose-email", {
        contactId,
        prospectId,
        context,
        tone,
      })
      return res.json() as Promise<{ subject: string; body: string }>
    },
    onSuccess: (data) => {
      setSubject(data.subject)
      setBody(data.body)
      toast({ title: "Email generated", description: "You can now edit and send the email." })
    },
    onError: (error: Error) => {
      toast({ title: "Generation failed", description: error.message, variant: "destructive" })
    },
  })

  const handleCopy = async () => {
    const fullEmail = `Subject: ${subject}\n\n${body}`
    await navigator.clipboard.writeText(fullEmail)
    toast({ title: "Copied to clipboard", description: "The email has been copied." })
  }

  const handleSendGhl = () => {
    toast({ title: "Send via GHL", description: "This would send the email via GoHighLevel." })
  }

  const hasGenerated = subject.length > 0 || body.length > 0

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="max-w-2xl" data-testid="dialog-email-composer">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Compose Email with AI
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email-context">What should this email be about?</Label>
            <Textarea
              id="email-context"
              data-testid="input-email-context"
              placeholder="Describe the purpose of this email..."
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email-tone">Tone</Label>
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger data-testid="select-email-tone">
                <SelectValue placeholder="Select a tone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="consultative and professional">Consultative and Professional</SelectItem>
                <SelectItem value="friendly and casual">Friendly and Casual</SelectItem>
                <SelectItem value="urgent follow-up">Urgent Follow-up</SelectItem>
                <SelectItem value="value-driven pitch">Value-driven Pitch</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            data-testid="button-generate-email"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !context || !tone}
            className="w-full"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Email with AI
              </>
            )}
          </Button>

          {hasGenerated && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email-subject">Subject</Label>
                <Input
                  id="email-subject"
                  data-testid="input-email-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email-body">Body</Label>
                <Textarea
                  id="email-body"
                  data-testid="textarea-email-body"
                  className="min-h-[200px]"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  data-testid="button-copy-email"
                  variant="outline"
                  onClick={handleCopy}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy to Clipboard
                </Button>
                <Button
                  data-testid="button-send-email"
                  onClick={handleSendGhl}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Send via GHL
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
