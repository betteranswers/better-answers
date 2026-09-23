import ast
import hashlib
import json
import sys

_HOLDS_A_BODY = (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def _is_docstring(statement: ast.stmt) -> bool:
    return (
        isinstance(statement, ast.Expr)
        and isinstance(statement.value, ast.Constant)
        and isinstance(statement.value.value, str)
    )


def _is_placeholder(body: list[ast.stmt]) -> bool:
    if len(body) != 1:
        return False
    only = body[0]
    return isinstance(only, ast.Expr) and (
        isinstance(only.value, ast.Constant) and only.value.value is Ellipsis
    )


def _without_docstrings(tree: ast.Module) -> ast.Module:
    for node in ast.walk(tree):
        if not isinstance(node, _HOLDS_A_BODY):
            continue
        body = list(node.body)
        if body and _is_docstring(body[0]):
            body = body[1:]

        if not isinstance(node, ast.Module) and (not body or _is_placeholder(body)):
            body = [ast.Pass()]
        node.body = body
    return tree


def normalize(source: str) -> str:
    hashbang = source.splitlines()[0] if source.startswith("#!") else ""
    tree = _without_docstrings(ast.parse(source))
    return f"{hashbang}\n{ast.dump(ast.parse(ast.unparse(tree)))}"


def parsed(language: str, source: str) -> str:
    if language == "toml":
        import tomllib

        loaded = tomllib.loads(source)
    else:
        import yaml

        loaded = list(yaml.safe_load_all(source))
    return json.dumps(loaded, default=str, ensure_ascii=False)


def main() -> int:
    request = json.load(sys.stdin)
    digests: dict[str, str] = {}
    errors: dict[str, str] = {}
    for key, source in request["sources"].items():
        try:
            canonical = normalize(source)
        except SyntaxError as failure:
            errors[key] = str(failure)
            continue
        digests[key] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    data: dict[str, str] = {}
    unread: dict[str, str] = {}
    for key, asked in request.get("data", {}).items():
        try:
            canonical = parsed(asked["language"], asked["source"])
        except Exception as failure:  # noqa: BLE001 — any parse failure is one answer
            unread[key] = f"{type(failure).__name__}: {failure}"
            continue
        data[key] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    json.dump(
        {"digests": digests, "errors": errors, "data": data, "unread": unread},
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
