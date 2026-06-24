import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

type Ctx = { open: (source?: string) => void };
const DemoCtx = createContext<Ctx>({ open: () => {} });

export const useDemoModal = () => useContext(DemoCtx);

export function DemoModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [source, setSource] = useState<string | undefined>();

  const open = useCallback((s?: string) => {
    setSource(s);
    setSubmitted(false);
    setIsOpen(true);
  }, []);

  useEffect(() => {
    if (!isOpen) setSubmitted(false);
  }, [isOpen]);

  return (
    <DemoCtx.Provider value={{ open }}>
      {children}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[520px] rounded-2xl">
          {!submitted ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold tracking-tight">Book your CognixHR demo</DialogTitle>
                <DialogDescription>
                  30-minute walkthrough tailored to your team. No credit card, full sandbox access.
                </DialogDescription>
              </DialogHeader>
              <form
                className="grid gap-4 pt-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSubmitted(true);
                }}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" required placeholder="Aarav Sharma" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="email">Work email</Label>
                    <Input id="email" type="email" required placeholder="you@company.com" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="company">Company</Label>
                    <Input id="company" required placeholder="Acme Pvt Ltd" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="size">Company size</Label>
                    <select
                      id="size"
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option>1–25</option>
                      <option>26–100</option>
                      <option>101–500</option>
                      <option>501–2000</option>
                      <option>2000+</option>
                    </select>
                  </div>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" type="tel" placeholder="+91 98xxxxxxxx" />
                  </div>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label htmlFor="message">Message {source ? <span className="text-xs text-muted-foreground">· from {source}</span> : null}</Label>
                    <Textarea id="message" rows={3} placeholder="What would you like to see?" />
                  </div>
                </div>
                <Button type="submit" size="lg" className="h-11 rounded-full bg-[#2E6FE6] text-white hover:bg-[#2E6FE6]/90">
                  Request demo
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  By submitting, you agree to our Privacy Policy. We'll reply within 1 business day.
                </p>
              </form>
            </>
          ) : (
            <div className="grid place-items-center gap-3 py-8 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-[#15B8A6]/15 text-[#15B8A6]">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <DialogTitle className="text-2xl font-bold">Thanks — we'll be in touch</DialogTitle>
              <p className="max-w-sm text-sm text-muted-foreground">
                A CognixHR specialist will reach out within 1 business day to schedule your walkthrough.
              </p>
              <Button onClick={() => setIsOpen(false)} variant="outline" className="mt-2 rounded-full">
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DemoCtx.Provider>
  );
}
