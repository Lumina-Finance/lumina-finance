from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category


@dataclass(frozen=True)
class SystemCategoryDefault:
    name: str
    kind: CategoryKind
    icon: str


# System categories visible to every user
SYSTEM_CATEGORY_DEFAULTS: tuple[SystemCategoryDefault, ...] = tuple(
    SystemCategoryDefault(name, kind, icon)
    for name, kind, icon in [
        # Family, health, and education
        ("Childcare", CategoryKind.EXPENSE, "🧸"),
        ("Education", CategoryKind.EXPENSE, "🎓"),
        ("Health", CategoryKind.EXPENSE, "🏥"),
        ("Personal Care", CategoryKind.EXPENSE, "✂️"),
        ("Pets", CategoryKind.EXPENSE, "🐾"),
        # Financial obligations
        ("Debt Payment", CategoryKind.EXPENSE, "🏦"),
        ("Insurance", CategoryKind.EXPENSE, "🛡️"),
        ("Taxes", CategoryKind.EXPENSE, "🏛️"),
        # Food and dining
        ("Dining", CategoryKind.EXPENSE, "🍽️"),
        ("Groceries", CategoryKind.EXPENSE, "🛒"),
        ("Takeout", CategoryKind.EXPENSE, "🥡"),
        # Income
        ("Bonus", CategoryKind.INCOME, "🏆"),
        ("Capital Gains", CategoryKind.INCOME, "📈"),
        ("Dividends", CategoryKind.INCOME, "🪙"),
        ("Freelance", CategoryKind.INCOME, "💻"),
        ("Interest", CategoryKind.INCOME, "💰"),
        ("Other Income", CategoryKind.INCOME, "💵"),
        ("Salary", CategoryKind.INCOME, "💼"),
        # Lifestyle and discretionary
        ("Entertainment", CategoryKind.EXPENSE, "🎬"),
        ("Gifts & Donations", CategoryKind.EXPENSE, "🎁"),
        ("Shopping", CategoryKind.EXPENSE, "🛍️"),
        ("Travel", CategoryKind.EXPENSE, "✈️"),
        # Living expenses
        ("Housing", CategoryKind.EXPENSE, "🏠"),
        ("Utilities", CategoryKind.EXPENSE, "💡"),
        # Miscellaneous
        ("Miscellaneous", CategoryKind.EXPENSE, "🏷️"),
        # Transfers
        ("Credit Card Payment", CategoryKind.TRANSFER, "💳"),
        ("Transfer", CategoryKind.TRANSFER, "↔️"),
        # Vehicle and transportation
        ("Fuel", CategoryKind.EXPENSE, "⛽"),
        ("Public Transit", CategoryKind.EXPENSE, "🚌"),
        ("Vehicle Maintenance", CategoryKind.EXPENSE, "🔧"),
    ]
)


async def seed_system_categories(db: AsyncSession) -> None:
    """Create or update global system categories."""
    existing_result = await db.execute(
        select(Category).where(Category.is_system.is_(True)),
    )
    existing_by_name = {
        category.name: category
        for category in existing_result.scalars().all()
    }

    for default in SYSTEM_CATEGORY_DEFAULTS:
        category = existing_by_name.get(default.name)
        if category is None:
            db.add(Category(
                owner_id=None,
                group_id=None,
                name=default.name,
                kind=default.kind,
                icon=default.icon,
                is_system=True,
            ))
            continue

        category.name = default.name
        category.kind = default.kind
        category.icon = default.icon
