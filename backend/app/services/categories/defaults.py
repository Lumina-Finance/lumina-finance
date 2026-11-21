"""System category default seeding service"""

import uuid
from dataclasses import dataclass

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category


@dataclass(frozen=True)
class SystemCategoryDefault:
    """System category values inserted during startup and tests"""

    name: str
    kind: CategoryKind
    icon: str


# System categories visible to every user
SYSTEM_CATEGORY_DEFAULTS: tuple[SystemCategoryDefault, ...] = tuple(
    SystemCategoryDefault(name, kind, icon)
    for name, kind, icon in [
        # Business expenses
        ("Advertising & Marketing", CategoryKind.EXPENSE, "📣"),
        ("Business Expenses", CategoryKind.EXPENSE, "💼"),
        ("Business Insurance", CategoryKind.EXPENSE, "🛡️"),
        ("Business Meals", CategoryKind.EXPENSE, "🍱"),
        ("Business Travel", CategoryKind.EXPENSE, "🧳"),
        ("Equipment", CategoryKind.EXPENSE, "🖥️"),
        ("Office Supplies", CategoryKind.EXPENSE, "📎"),
        ("Professional Services", CategoryKind.EXPENSE, "🤝"),
        # Family, health, and education
        ("Childcare", CategoryKind.EXPENSE, "🧸"),
        ("Dental", CategoryKind.EXPENSE, "🦷"),
        ("Education", CategoryKind.EXPENSE, "🎓"),
        ("Health", CategoryKind.EXPENSE, "🏥"),
        ("Medical", CategoryKind.EXPENSE, "🩺"),
        ("Medicine", CategoryKind.EXPENSE, "💊"),
        ("Personal Care", CategoryKind.EXPENSE, "✂️"),
        ("Pets", CategoryKind.EXPENSE, "🐾"),
        # Financial obligations
        ("Debt Payment", CategoryKind.EXPENSE, "🏦"),
        ("Financial Fees", CategoryKind.EXPENSE, "💸"),
        ("Insurance", CategoryKind.EXPENSE, "🛡️"),
        ("Legal Fees", CategoryKind.EXPENSE, "⚖️"),
        ("Business Taxes", CategoryKind.EXPENSE, "🏛️"),
        ("Income Taxes", CategoryKind.EXPENSE, "📄"),
        ("Payroll Taxes", CategoryKind.EXPENSE, "🧾"),
        ("Property Taxes", CategoryKind.EXPENSE, "🏘️"),
        ("Sales Taxes", CategoryKind.EXPENSE, "🧮"),
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
        ("Electronics", CategoryKind.EXPENSE, "🔌"),
        ("Entertainment", CategoryKind.EXPENSE, "🎬"),
        ("Gifts & Donations", CategoryKind.EXPENSE, "🎁"),
        ("Hobby", CategoryKind.EXPENSE, "🎨"),
        ("Shopping", CategoryKind.EXPENSE, "🛍️"),
        ("Travel", CategoryKind.EXPENSE, "✈️"),
        ("Software", CategoryKind.EXPENSE, "💿"),
        # Living expenses
        ("Condo Maintenance", CategoryKind.EXPENSE, "🧰"),
        ("Digital News", CategoryKind.EXPENSE, "📰"),
        ("Print News", CategoryKind.EXPENSE, "🗞️"),
        ("Electricity", CategoryKind.EXPENSE, "💡"),
        ("Propane/LNG", CategoryKind.EXPENSE, "🔥"),
        ("Home Phone", CategoryKind.EXPENSE, "☎️"),
        ("Home Improvement", CategoryKind.EXPENSE, "🔨"),
        ("Home Repairs", CategoryKind.EXPENSE, "🛠️"),
        ("Housing", CategoryKind.EXPENSE, "🏠"),
        ("Internet", CategoryKind.EXPENSE, "🌐"),
        ("Phone Plan", CategoryKind.EXPENSE, "📱"),
        ("HOA Fees", CategoryKind.EXPENSE, "🏢"),
        ("Rent", CategoryKind.EXPENSE, "🏡"),
        ("Water", CategoryKind.EXPENSE, "🚰"),
        # Miscellaneous
        ("Miscellaneous", CategoryKind.EXPENSE, "🏷️"),
        # Transfers
        ("Balance Adjustment", CategoryKind.TRANSFER, "⚖️"),
        ("Credit Card Payment", CategoryKind.TRANSFER, "💳"),
        ("Transfer", CategoryKind.TRANSFER, "↔️"),
        # Vehicle and transportation
        ("Fuel", CategoryKind.EXPENSE, "⛽"),
        ("Parking", CategoryKind.EXPENSE, "🅿️"),
        ("Public Transit", CategoryKind.EXPENSE, "🚌"),
        ("Ride Hailing", CategoryKind.EXPENSE, "🚗"),
        ("Taxis", CategoryKind.EXPENSE, "🚕"),
        ("Tolls", CategoryKind.EXPENSE, "🛣️"),
        ("Vehicle Maintenance", CategoryKind.EXPENSE, "🔧"),
    ]
)


async def seed_system_categories(db: AsyncSession) -> None:
    """Create or update global system categories

    Args:
        db: Active database session

    """
    rows = [
        {
            "id": uuid.uuid4(),
            "owner_id": None,
            "group_id": None,
            "name": default.name,
            "kind": default.kind,
            "icon": default.icon,
            "is_system": True,
        }
        for default in SYSTEM_CATEGORY_DEFAULTS
    ]
    statement = insert(Category).values(rows)

    # One statement against the unique index on the folded system name, so a run beside this one waits
    # for it and updates the same rows, and a stored name in other capitals is updated rather than
    # added beside. The predicate is written as the index's own, since the database picks the index by it
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[func.lower(Category.name)],
            index_where=text("is_system = true"),
            set_={"name": statement.excluded.name, "kind": statement.excluded.kind, "icon": statement.excluded.icon},
        )
    )
