import os

# onnxruntime reads this as it loads, and its telemetry uploader can abort the
# process at exit.
os.environ["ORT_DISABLE_TELEMETRY"] = "1"

__all__ = ["__version__"]

__version__ = "0.1.0"
