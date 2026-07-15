"""Corpus package — layered test fixtures for the polytoken PDF pipeline.

Three layers:
  scan_noise/     — synthetic image-only PDFs representing scanned invoice noise
                    (modelled after RVL-CDIP invoice subset and DocLayNet pages)
  logistics_vocab/ — hand-authored logistics format templates with realistic
                    vocabulary (BL, commercial invoice, packing list, booking)
  hard_cases/     — controlled hard-case PDFs with paired ground truth:
                    multi-invoice-in-one-pdf, nested-entities-on-one-page,
                    junk-corrupt, photo-of-screen

See manifest.json for per-file metadata and ground_truth.json for expected
entity types and key identifier values for the hard_cases layer.
"""

from pathlib import Path

CORPUS_DIR: Path = Path(__file__).parent
MANIFEST_PATH: Path = CORPUS_DIR / "manifest.json"
GROUND_TRUTH_PATH: Path = CORPUS_DIR / "ground_truth.json"
