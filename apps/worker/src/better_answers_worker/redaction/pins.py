PRESIDIO_VERSION = "2.2.364"


GLINER_VERSION = "0.2.29"


SPACY_VERSION = "3.8.16"


TORCH_VERSION = "2.14.0"


SPACY_MODEL = "en_core_web_sm"
SPACY_MODEL_VERSION = "3.8.0"


GLINER_MODEL_ID = "urchade/gliner_multi_pii-v1"


GLINER_MODEL_ID_MEASURED = "knowledgator/gliner-pii-base-v1.0"


RULE_VERSION = "5"


_MODEL_IN_A_PIN = GLINER_MODEL_ID.rsplit("/", 1)[-1].replace("_", "-")
_SPACY_MODEL_IN_A_PIN = SPACY_MODEL.replace("_", "-")


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


VERSION_STRING = f"{RULE_VERSION}:{DETECTOR_PIN}"
