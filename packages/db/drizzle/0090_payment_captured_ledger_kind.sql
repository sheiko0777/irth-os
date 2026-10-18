-- Custom SQL migration file, put your code below! --
ALTER TYPE "ledger_entry_kind" ADD VALUE IF NOT EXISTS 'payment_captured';
