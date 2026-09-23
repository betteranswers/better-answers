from .contract_digest import (
    CONTRACT_STAMP_MODULE,
    CONTRACTS_ROOT,
    contract_digest,
    render_contract_stamp,
)


def main() -> int:
    CONTRACT_STAMP_MODULE.write_text(
        render_contract_stamp(contract_digest(CONTRACTS_ROOT)), encoding="utf-8"
    )
    return 0
