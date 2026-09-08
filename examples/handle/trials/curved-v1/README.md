# Curved handle developer proof

Actual isolated build123d geometry, independent regeneration and eight initial / nine refinement checks passed. This is fixed developer input with synthetic acceptance, not a product model run or user acceptance. STEP, STL, editable source and structured results retain their original bytes and hashes. Result paths are logical fixture references.

Reproduce from the TOOLS worktree:

```sh
node --import tsx src/tools/prove_curved_handle.ts examples/handle/trials/curved-v1/initial/source.py examples/handle/trials/curved-v1/refined/source.py
```

Initial: 110 mm overall length, 96 mm pad pitch, curved 8 mm thick bridge, 10 mm grip width, 1.5 mm edge fillets. Refinement: 14 mm wide bridge plus rounded 24 by 10 by 4 mm thumb shelf. Independent checks measured no removed material. Appearance review remains separate from geometry checks; no physical comfort, fit or strength claim.
