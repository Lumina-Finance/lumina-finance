"""Import rule models"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    VARCHAR,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, check_values

# Characters a rule's name may carry
MAX_IMPORT_RULE_NAME_LENGTH = 100


class ImportRuleMatch(enum.StrEnum):
    """Whether a rule, or a group inside it, needs all of its items to hold or any one of them"""

    ALL = "all"
    ANY = "any"


class ImportRule(Base):
    """One of a user's rules for filling in an imported transaction's merchant, category and tags

    Rules are checked in position order, counted from zero without gaps. The conditions are held
    as JSON because a rule's items nest one level and differ in shape by attribute, and nothing
    queries inside them. The schemas validate them on the way in, and an account a condition
    names is looked up when the rules are read, so deleting that account leaves the condition in
    place to say so
    """

    __tablename__ = "import_rules"
    __table_args__ = (
        CheckConstraint(f"match IN ({check_values(ImportRuleMatch)})", name="ck_import_rules_match"),
        CheckConstraint("position >= 0", name="ck_import_rules_position"),
        # A move shifts the rules between two places in one statement, so two rules hold the same
        # position until it ends and the clash is checked at commit rather than after each row
        UniqueConstraint(
            "owner_id",
            "position",
            name="uq_import_rules_owner_position",
            deferrable=True,
            initially="DEFERRED",
        ),
        # Built on the name with capitals folded, so the database refuses the pair the routes
        # refuse: Market beside market. A constraint cannot be written against an expression, so
        # this is an index
        Index("uq_import_rules_owner_name", "owner_id", text("lower(name)"), unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(VARCHAR(MAX_IMPORT_RULE_NAME_LENGTH), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    match: Mapped[str] = mapped_column(VARCHAR(3), nullable=False)
    conditions: Mapped[list[dict]] = mapped_column(JSONB, nullable=False)

    # Deleting a merchant or category a rule names is refused before the database is asked, so the
    # keys do not cascade. Indexed so that check, and the database's own, finds the rules naming
    # one without reading every user's
    merchant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("merchants.id"), index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class ImportRuleTag(Base):
    """A tag a rule adds"""

    __tablename__ = "import_rule_tags"

    import_rule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_rules.id", ondelete="CASCADE"), primary_key=True)

    # Indexed so deleting a tag checks for the rules adding it without reading every user's, since
    # the primary key leads on the rule. The key does not cascade, as a rule's merchant's does not
    tag_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tags.id"), primary_key=True, index=True)
