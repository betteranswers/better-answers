"""The redaction seam: what a document's text must not carry past this point.

The package is one module from the outside. Its one public function takes the
normalised text of a document, the rules in force on its binding, the suppressions
that apply to it and a per-binding seed, and answers the redacted text with the
findings, the counts, the narrowing verdict and the version string. It reads nothing
but its arguments and memoises nothing: the memoised wrap around it belongs to the
pipeline, and a seam that cached anything of its own would be a second cache with a
second lifetime.

What is here today is the half with no detector in it — the pins every version is
declared in, and the category descriptors everything else derives from. The analyzer,
the recognisers and the public function follow them.
"""
