"""Group definitions for the insights net worth card"""

from dataclasses import dataclass

from app.models.account import Account
from app.models.base import AccountKind, AccountType
from app.schemas.insights import NetWorthGroupKind


@dataclass(frozen=True)
class NetWorthGroup:
    """Store one net worth chart group definition

    Attributes:
        id: Stable group ID returned in the response
        name: Display name returned in the response
        kind: Whether the group belongs to assets or debt
    """

    id: str
    name: str
    kind: NetWorthGroupKind


NET_WORTH_GROUPS: tuple[NetWorthGroup, ...] = (
    NetWorthGroup("cash", "Cash", "asset"),
    NetWorthGroup("term_deposits", "Term Deposits", "asset"),
    NetWorthGroup("investments", "Investments", "asset"),
    NetWorthGroup("other_assets", "Other Assets", "asset"),
    NetWorthGroup("revolving_debt", "Revolving Debt", "debt"),
    NetWorthGroup("loans", "Loans", "debt"),
    NetWorthGroup("mortgages", "Mortgages", "debt"),
    NetWorthGroup("other_debt", "Other Debt", "debt"),
)

NET_WORTH_GROUP_INDEX_BY_ID = {group.id: index for index, group in enumerate(NET_WORTH_GROUPS)}


def get_net_worth_group_id_for_account(account: Account) -> str:
    """Return the net worth group ID for an account

    Args:
        account: Account being placed into a chart group

    Returns:
        Net worth group ID for the account
    """
    if account.account_kind == AccountKind.ASSET:
        if account.account_type in {AccountType.CHECKING, AccountType.SAVINGS, AccountType.CASH}:
            return "cash"
        if account.account_type == AccountType.TERM_DEPOSIT:
            return "term_deposits"
        if account.account_type == AccountType.INVESTMENT:
            return "investments"
        return "other_assets"

    if account.account_type in {AccountType.CREDIT_CARD, AccountType.LINE_OF_CREDIT, AccountType.HELOC}:
        return "revolving_debt"
    if account.account_type == AccountType.LOAN:
        return "loans"
    if account.account_type == AccountType.MORTGAGE:
        return "mortgages"
    return "other_debt"
