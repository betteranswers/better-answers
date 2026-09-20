"""Every version the redaction seam is pinned to, and the string a finding carries.

Each version below was read on 11 September 2026: the two presidio packages, gliner,
spacy and torch from PyPI's own release metadata for each of them, and the English
pipeline from the newest English release on Explosion's spacy-models repository. The
worker's `pyproject.toml` pins the same versions for the installer, and one test holds
these constants, that manifest and what the running interpreter reports together, so a
pin cannot age alone in any of the three.

The version string every finding carries is two halves joined by a single colon.
`RULE_VERSION` is the half this repository decides, bumped whenever a rule, the
category table or a recogniser changes; `DETECTOR_PIN` is the half it decided with. A
re-detection compares the two to tell what moved and re-baselines only the evidence
resting on it. Neither half may hold a colon or whitespace: the other tier splits the
string once, from whichever end it likes, and has to land in the same place.
"""

#: The analyzer and the anonymizer are released together and carry one version between
#: them, so a pin that differed between the two would be a resolver error rather than
#: a decision anybody took.
PRESIDIO_VERSION = "2.2.364"

#: The NER library, named by this repository rather than left to Presidio's extra:
#: that extra's range would let the model deciding what a name is move under the
#: fixture.
GLINER_VERSION = "0.2.29"

#: Tokenisation and lemmas only — the seam takes spaCy's own NER recogniser out of the
#: registry and keeps the pipeline for the lemmas the context enhancer reads.
SPACY_VERSION = "3.8.16"

#: GLiNER's tensor runtime. Linux installs the `+cpu` build of it; the detector never
#: asks for a device, so a CUDA runtime on the image would be weight nothing calls.
TORCH_VERSION = "2.14.0"

#: The English pipeline spaCy loads. It is published as a release asset and not to
#: PyPI, so the download URL in the manifest is what pins it and these two are its
#: halves.
SPACY_MODEL = "en_core_web_sm"
SPACY_MODEL_VERSION = "3.8.0"

#: The model the analyzer runs as its NER, on the CPU. The alternative considered
#: beside it, `knowledgator/gliner-pii-base-v1.0`, is measured against this one on the
#: fixture's own page rather than chosen from a benchmark somebody else ran.
GLINER_MODEL_ID = "urchade/gliner_multi_pii-v1"

#: The alternative the line above names, and the id that comparison was taken against on
#: 11 September 2026 — read from Hugging Face that day, and never fetched since. The
#: image no longer carries it (`T-148`): `weights.py`'s table is the run pin alone, so
#: the comparison stands on its recorded figures in `tests/test_image.py`'s docblock and
#: is not re-runnable from an image that cannot load the second model. It stays a
#: declared constant rather than a string loose in a docblock for two reasons. A model
#: id is a pinned value, and every pinned value this tier depends on is declared once
#: here as an exported constant rather than spelled again wherever it is read. And the
#: seam has to be able to name it to prove it absent: a finding must carry the model
#: that detected it and never the one nobody ran, which is an assertion only a pinned
#: string can make.
GLINER_MODEL_ID_MEASURED = "knowledgator/gliner-pii-base-v1.0"

#: This repository's own half of the version string. A rule, the category table, the
#: consumer-domain list or a recogniser changing is one edit and this bump; the suite
#: holds a digest of the table and the list beside it, so the three cannot move apart.
#: Version 2 is the consumer-domain list: before it, every email address the built-in
#: matched was personal contact, so a supplier's own corporate address was withheld
#: from readers entitled to it. Version 3 is the health cue list, which held *health*
#: and *condition* until T-179: a safety policy and a condition of contract were each
#: withheld whole and narrowed their document to Restricted, at the tier no binding
#: switches off. Version 4 is the rule on where a window into a page begins (`T-177`):
#: before it a window began at a count of characters from the start of the text, which
#: put its edge inside a word — the model was shown a fragment and answered for it, a
#: `person-name` over half a word, and every later pseudonym letter shifted — and made
#: what the model saw of one paragraph depend on how much text sat above it. A window
#: now begins where a heading does. On this repository's fixture page the rule raises
#: **the same twenty-four spans under the same categories**, gaining none and losing
#: none; fourteen of them carry a different score, the largest move being `job-title`
#: *second registered officer* from 0.778 to 0.726. A moved score is a moved answer, so
#: it is a moved version.

RULE_VERSION = "4"

#: Two spellings, one name: a pin is written in the hyphens a package name uses,
#: because a slash would read as a path and an underscore as a second spelling of one
#: thing.
_MODEL_IN_A_PIN = GLINER_MODEL_ID.rsplit("/", 1)[-1].replace("_", "-")
_SPACY_MODEL_IN_A_PIN = SPACY_MODEL.replace("_", "-")

#: Everything the detector's answer depends on, in one token of the version string: an
#: answer that moved because a package moved is re-baselined, and a pin naming only
#: some of them could not say which.
DETECTOR_PIN = "+".join(
    (
        f"presidio-{PRESIDIO_VERSION}",
        f"gliner-{GLINER_VERSION}",
        f"torch-{TORCH_VERSION}",
        f"spacy-{SPACY_VERSION}",
        f"{_SPACY_MODEL_IN_A_PIN}-{SPACY_MODEL_VERSION}",
        _MODEL_IN_A_PIN,
    )
)

#: What rides on every finding the seam raises, and on the document from the moment
#: the index writes one.
VERSION_STRING = f"{RULE_VERSION}:{DETECTOR_PIN}"
