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

#: The alternative the line above names, pinned here because the image fetches it: S0
#: measures it against the pin on the fixture's own page and never runs it, so it is in
#: no version string and no finding. Read from Hugging Face on 11 September 2026. It is
#: a constant of its own rather than a string in the Dockerfile because a model id is a
#: pinned value and `[DEPS2]` gives each of those one place to live.
GLINER_MODEL_ID_MEASURED = "knowledgator/gliner-pii-base-v1.0"

#: This repository's own half of the version string. A rule, the category table or a
#: recogniser changing is one edit and this bump; the suite holds a digest of the
#: table beside it, so the two cannot move apart.
RULE_VERSION = "1"

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
