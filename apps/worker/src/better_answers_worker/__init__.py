import os

# onnxruntime reads this as it loads, and its uploader can abort the process at exit.
# At the root, so no module here reaches onnxruntime first.
os.environ["ORT_DISABLE_TELEMETRY"] = "1"

__all__ = ["__version__"]

__version__ = "0.1.0"
