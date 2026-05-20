"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateCategoryButton({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const router = useRouter();

  const createMutation = trpc.categories.create.useMutation({
    onSuccess: () => {
      setOpen(false);
      setName("");
      setSlug("");
      router.refresh();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{label}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <Button
            disabled={createMutation.isPending || !name || !slug}
            onClick={() => createMutation.mutate({ name, slug })}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteCategoryButton({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const router = useRouter();
  const deleteMutation = trpc.categories.delete.useMutation({
    onSuccess: () => {
      router.refresh();
    },
  });

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-red-500 hover:text-red-600 hover:bg-red-50"
      disabled={deleteMutation.isPending}
      onClick={() => deleteMutation.mutate({ id })}
    >
      {label}
    </Button>
  );
}
