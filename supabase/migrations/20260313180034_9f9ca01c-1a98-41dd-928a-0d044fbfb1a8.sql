
-- For each numero_frota with duplicates, keep the record that has motorista data (or the most recent),
-- and deactivate the rest
WITH ranked AS (
  SELECT id, numero_frota,
    ROW_NUMBER() OVER(
      PARTITION BY numero_frota 
      ORDER BY 
        (motorista_id IS NOT NULL) DESC, 
        (gestor_id IS NOT NULL) DESC,
        updated_at DESC
    ) as rn
  FROM cadastros
  WHERE ativo = true
)
UPDATE cadastros 
SET ativo = false, updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
