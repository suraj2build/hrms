-- 371_import_chunk_checksum.sql
--
-- Add an immutable structural checksum to import_job_chunks.
--
-- Purpose: deterministic chunk identity for self-healing imports.
-- On resume, the executor can verify it is about to replay exactly
-- the same row range as the original run, making replay safe even
-- if the source file is re-uploaded between runs.
--
-- Checksum is computed over: jobId:chunkNo:startRow:endRow
-- (djb2 hash, hex-encoded, 8 chars). It is written once at chunk
-- creation time and never updated (ignoreDuplicates upsert).

ALTER TABLE import_job_chunks
  ADD COLUMN IF NOT EXISTS checksum TEXT;
