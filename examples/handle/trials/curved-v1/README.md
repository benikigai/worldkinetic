# Curved handle developer proof

Actual isolated build123d geometry, independent regeneration and eight initial / nine refinement checks passed. This is fixed developer input with synthetic acceptance, not a product model run or user acceptance. STEP, STL and editable source retain their original bytes and hashes. Structured results preserve measurements and the check-bundle hash, with artifact paths relocated to logical fixture references. Provenance records the original private result hash.

Reproduce from the TOOLS worktree:

```sh
node --import tsx src/tools/prove_curved_handle.ts examples/handle/trials/curved-v1/initial/source.py examples/handle/trials/curved-v1/refined/source.py
```

Initial: 110 mm overall length, 96 mm pad pitch, curved 8 mm thick bridge, 10 mm grip width, 1.5 mm edge fillets. Refinement: 14 mm wide bridge plus rounded 24 by 10 by 4 mm thumb shelf. Independent checks measured no removed material. Appearance review remains separate from geometry checks; no physical comfort, fit or strength claim.
