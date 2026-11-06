"""Generate schema references from a fresh, disposable migration baseline."""

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, cast

import psycopg
from psycopg.rows import dict_row

from services.db.supabase.tests.isolated_database import isolated_database

DOCS = Path(__file__).resolve().parent
FIGURES = DOCS / "figures" / "database"
RENDERER = "ghcr.io/mermaid-js/mermaid-cli/mermaid-cli:11.12.0"
GROUPS = (
    (
        "02-ownership",
        "Ownership fees and access",
        (
            "public.companies",
            "public.app_accounts",
            "public.skus",
            "public.sku_terms_versions",
            "public.sku_fee_periods",
        ),
    ),
    (
        "03-finances-observations",
        "Finances acquisitions and successful batch membership",
        (
            "private.finances_acquisitions",
            "private.finances_preprocess_batches",
            "private.finances_preprocess_batch_transactions",
        ),
    ),
    (
        "03b-finances-facts",
        "Finances transaction identities versions and components",
        (
            "private.finances_transactions",
            "private.finances_transaction_versions",
            "private.finances_transaction_components",
        ),
    ),
    (
        "04-data-kiosk-observations",
        "Data Kiosk acquisitions and successful batch membership",
        (
            "private.data_kiosk_acquisitions",
            "private.data_kiosk_preprocess_batches",
            "private.data_kiosk_preprocess_batch_days",
        ),
    ),
    (
        "05-data-kiosk-facts",
        "Data Kiosk day identities versions and components",
        (
            "private.data_kiosk_days",
            "private.data_kiosk_day_versions",
            "private.data_kiosk_day_components",
        ),
    ),
    (
        "06-payout-results",
        "Payout results and refresh state",
        (
            "public.company_payout_reports",
            "public.company_payout_report_components",
            "private.payout_report_refresh_state",
        ),
    ),
    (
        "07-payout-manifests",
        "Payout source batches day versions and terms manifests",
        (
            "private.payout_report_finances_batches",
            "private.payout_report_data_kiosk_observations",
            "private.payout_report_terms_versions",
        ),
    ),
    ("08-revisions", "Workspace revision tokens", ("private.workspace_revision_tokens",)),
    (
        "09-daily-inventory",
        "Daily inventory captures",
        (
            "private.inventory_acquisitions",
            "private.inventory_daily_captures",
            "private.inventory_items",
        ),
    ),
)


def load_schema() -> tuple[dict[str, dict[str, Any]], list[dict[str, str]]]:
    """Install the repository migrations without reading any existing source data."""
    with (
        isolated_database() as url,
        psycopg.Connection[dict[str, Any]].connect(url, row_factory=dict_row) as connection,
    ):
        objects = connection.execute("""
            select c.oid, n.nspname || '.' || c.relname as name, c.relkind as kind
            from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname in ('public','private') and c.relkind in ('r','v')
            order by n.nspname,c.relname
        """).fetchall()
        for obj in objects:
            obj["columns"] = connection.execute(
                """
                select a.attname as name, format_type(a.atttypid,a.atttypmod) as type,
                    a.attnotnull as not_null, pg_get_expr(d.adbin,d.adrelid) as default
                from pg_attribute a left join pg_attrdef d
                    on d.adrelid=a.attrelid and d.adnum=a.attnum
                where a.attrelid=%s and a.attnum>0 and not a.attisdropped order by a.attnum
            """,
                (obj["oid"],),
            ).fetchall()
            obj["constraints"] = connection.execute(
                """
                select c.conname as name,c.contype as kind,
                    pg_get_constraintdef(c.oid) as definition,
                    n.nspname || '.' || p.relname as parent,
                    (select array_agg(a.attname order by k.ord)
                     from unnest(c.conkey) with ordinality k(num,ord)
                     join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num) as columns
                from pg_constraint c left join pg_class p on p.oid=c.confrelid
                left join pg_namespace n on n.oid=p.relnamespace
                where c.conrelid=%s order by c.contype,c.conname
            """,
                (obj["oid"],),
            ).fetchall()
            obj.pop("oid")
        dependencies = connection.execute("""
            select distinct vn.nspname || '.' || v.relname as view,
                sn.nspname || '.' || s.relname as source
            from pg_rewrite r join pg_class v on v.oid=r.ev_class
            join pg_namespace vn on vn.oid=v.relnamespace
            join pg_depend d on d.classid='pg_rewrite'::regclass and d.objid=r.oid
            join pg_class s on s.oid=d.refobjid and d.refclassid='pg_class'::regclass
            join pg_namespace sn on sn.oid=s.relnamespace
            where v.relkind='v' and vn.nspname in ('public','private')
                and sn.nspname in ('public','private','auth') and v.oid<>s.oid
            union
            select distinct vn.nspname || '.' || v.relname,
                pn.nspname || '.' || p.proname || '()'
            from pg_rewrite r join pg_class v on v.oid=r.ev_class
            join pg_namespace vn on vn.oid=v.relnamespace
            join pg_depend d on d.classid='pg_rewrite'::regclass and d.objid=r.oid
            join pg_proc p on p.oid=d.refobjid and d.refclassid='pg_proc'::regclass
            join pg_namespace pn on pn.oid=p.pronamespace
            where v.relkind='v' and vn.nspname in ('public','private')
                and pn.nspname in ('public','private','auth') order by 1,2
        """).fetchall()
    return {obj["name"]: obj for obj in objects}, dependencies


def node(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", name)


def keyed_columns(table: dict[str, Any], kind: str) -> set[str]:
    return {
        column
        for key in table["constraints"]
        if key["kind"] == kind
        for column in cast(list[str], key["columns"] or [])
    }


def er_diagram(names: tuple[str, ...], schema: dict[str, dict[str, Any]]) -> str:
    references = {
        c["parent"] for name in names for c in schema[name]["constraints"] if c["kind"] == "f"
    } - set(names)
    lines = ["erDiagram", "    direction LR"]
    for name in names:
        table = schema[name]
        nulls = {column["name"]: not column["not_null"] for column in table["columns"]}
        for key in table["constraints"]:
            if key["kind"] != "f":
                continue
            parent_side = "o|" if any(nulls[c] for c in key["columns"]) else "||"
            unique = any(
                k["kind"] in {"p", "u"} and set(k["columns"]) <= set(key["columns"])
                for k in table["constraints"]
            )
            child_side = "o|" if unique else "o{"
            identifying = set(key["columns"]) <= keyed_columns(table, "p")
            edge = "--" if identifying else ".."
            lines.append(
                f"    {node(key['parent'])} {parent_side}{edge}{child_side} "
                f'{node(name)} : "{" + ".join(key["columns"])}"'
            )
    for name in (*names, *sorted(references)):
        full = name in names
        table = schema.get(
            name,
            {
                "columns": [{"name": "id", "type": "uuid", "not_null": True}],
                "constraints": [{"kind": "p", "columns": ["id"]}],
            },
        )
        primary = keyed_columns(table, "p")
        foreign = keyed_columns(table, "f")
        lines.extend(["", f'    {node(name)}["{name}{" (reference)" if not full else ""}"] {{'])
        for column in table["columns"]:
            if not full and column["name"] not in primary:
                continue
            data_type = re.sub(r"[^A-Za-z0-9_\[\]]", "_", column["type"].split(".")[-1])
            flags = [
                key
                for key, values in (("PK", primary), ("FK", foreign))
                if column["name"] in values
            ]
            marker = " " + ", ".join(flags) if flags else ""
            nullability = "NN" if column["not_null"] else "NULL"
            lines.append(f'        {data_type} {column["name"]}{marker} "{nullability}"')
        lines.append("    }")
    return "\n".join(lines) + "\n"


def overview(schema: dict[str, dict[str, Any]]) -> str:
    lines = [
        "flowchart LR",
        '    auth_users["auth.users · managed"]',
        '    ARCHIVES["Private Storage archives · manifest references"]',
    ]
    for index, (filename, _title, names) in enumerate(GROUPS):
        label = (
            filename.split("-", 1)[1]
            .replace("-", " ")
            .capitalize()
            .replace("Data kiosk", "Data Kiosk")
        )
        lines.append(f'    subgraph GROUP_{index}["{label}"]')
        lines.extend(f'        {node(name)}["{name}"]' for name in names)
        lines.append("    end")
    for name, table in schema.items():
        if table["kind"] != "r":
            continue
        for constraint in table["constraints"]:
            if constraint["kind"] == "f":
                lines.append(f"    {node(name)} --> {node(constraint['parent'])}")
        if name.endswith("_acquisitions"):
            lines.append(f"    {node(name)} -.-> ARCHIVES")
    return "\n".join(lines) + "\n"


def view_diagram(schema: dict[str, dict[str, Any]], dependencies: list[dict[str, str]]) -> str:
    names = {name for name, obj in schema.items() if obj["kind"] == "v"}
    names.update(item["source"] for item in dependencies)
    lines = ["flowchart LR"]
    for name in sorted(names):
        kind = (
            "VIEW"
            if schema.get(name, {}).get("kind") == "v"
            else ("FUNCTION" if name.endswith("()") else "TABLE")
        )
        lines.append(f'    {node(name)}["{kind} {name}"]')
    lines.extend(f"    {node(item['source'])} --> {node(item['view'])}" for item in dependencies)
    return "\n".join(lines) + "\n"


def markdown(schema: dict[str, dict[str, Any]]) -> str:
    tables = [obj for obj in schema.values() if obj["kind"] == "r"]
    views = [obj for obj in schema.values() if obj["kind"] == "v"]
    columns = sum(len(obj["columns"]) for obj in tables)
    fks = sum(key["kind"] == "f" for obj in tables for key in obj["constraints"])
    lines = [
        "# Database schema",
        "",
        f"The fresh-install migrations define **{len(tables)} application tables, {columns} "
        f"table columns, {fks} foreign keys and {len(views)} ordinary views**. These figures "
        "and keys are generated from an isolated installation of the actual migrations, "
        "without reading existing financial data.",
        "",
        "Finances stores stable transaction identities, immutable transaction versions and "
        "components, and the exact versions observed by each successful preprocessing batch. "
        "All Finance business validation runs in Python before publication; raw pages stay in "
        "private Storage. Data Kiosk reuses immutable complete-day versions across successful "
        "batches. Both retain all accepted versions without raw response JSON in component rows. "
        "Payouts reference Finance batches, Data Kiosk batch/day/version membership and company "
        "terms. Diagnostic source aggregates are computed on read; "
        "comparisons are frontend values. "
        "Inventory keeps its separate one-capture-per-day model.",
        "",
        "See [data workflows](data_workflows.md), "
        "[Finances transactions](finances_transactions.md), "
        "[source allocation](source_allocation.md), [company terms](company_fees.md), "
        "[payouts](company_payout_reports.md), and [access](access_control.md) "
        "for behavioral contracts.",
        "",
        "## Reading the figures",
        "",
        "Every application table column appears in its group's full figure. `NN` means NOT NULL; "
        "`NULL` means nullable. Repeated PK markers identify a composite primary key. FK markers "
        "can be members of a composite constraint; exact tuples are listed below. A reference "
        "box includes only the referenced primary key. Managed Auth/Storage internals appear "
        "only at their application boundaries. Overview arrows point from child to parent; "
        "dotted archive links are manifest references, not SQL foreign keys.",
        "",
    ]
    figures = [
        ("01-overview", "Complete relationship map"),
        *((name, title) for name, title, _ in GROUPS),
        ("10-inventory-workflow", "Inventory workflow"),
        ("11-views", "Views and direct catalog dependencies"),
    ]
    for filename, title in figures:
        lines.extend(
            [
                f"## {title}",
                "",
                f"![{title}](figures/database/{filename}.svg)",
                "",
                f"[Full SVG](figures/database/{filename}.svg) · "
                f"[Mermaid source](figures/database/{filename}.mmd)",
                "",
            ]
        )
    lines.extend(
        [
            "View dependencies show direct references tracked by PostgreSQL. Function nodes are "
            "boundaries; quoted SQL or procedural function bodies can read additional objects "
            "without creating a catalog dependency edge.",
            "",
            "## Primary and unique keys",
            "",
            "| Table | Primary key | Additional unique keys |",
            "| --- | --- | --- |",
        ]
    )
    for table in tables:
        keys = table["constraints"]
        primary = next((key["columns"] for key in keys if key["kind"] == "p"), list[str]())
        unique = ["(" + ", ".join(key["columns"]) + ")" for key in keys if key["kind"] == "u"]
        lines.append(
            f"| `{table['name']}` | `({', '.join(primary)})` | "
            + ("; ".join(f"`{key}`" for key in unique) or "None")
            + " |"
        )
    lines.extend(["", "## Foreign keys", "", "| Child table | Constraint |", "| --- | --- |"])
    for table in tables:
        for key in table["constraints"]:
            if key["kind"] == "f":
                definition = key["definition"].replace("|", "\\|")
                lines.append(f"| `{table['name']}` | `{definition}` |")
    lines.extend(["", "## Read views", "", "| View | Columns |", "| --- | --- |"])
    for view in views:
        names = ", ".join(f"`{column['name']}`" for column in view["columns"])
        lines.append(f"| `{view['name']}` | {names} |")
    lines.extend(
        [
            "",
            "## Regenerate",
            "",
            "From the repository root with the local test PostgreSQL server and Docker running:",
            "",
            "```sh",
            "conda run --no-capture-output -n A-SelBox python -m "
            "docs.generate_schema_figures --render",
            "```",
            "",
            "The generator installs migrations in a disposable database, derives "
            "columns/constraints/views from PostgreSQL catalogs, and removes that database. "
            "SVG rendering uses the pinned Mermaid CLI Docker image; no native Node/npm "
            "installation is required. `--check` verifies Markdown/Mermaid sources without "
            "changing files. The inventory workflow is a maintained behavioral diagram; "
            "all relational figures are generated.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--render", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    schema, dependencies = load_schema()
    configured = {name for _, _, names in GROUPS for name in names}
    actual = {name for name, table in schema.items() if table["kind"] == "r"}
    if configured != actual:
        raise ValueError(f"Diagram groups do not cover the schema: {configured ^ actual}")
    contents = {FIGURES / f"{name}.mmd": er_diagram(names, schema) for name, _, names in GROUPS}
    contents[FIGURES / "01-overview.mmd"] = overview(schema)
    contents[FIGURES / "11-views.mmd"] = view_diagram(schema, dependencies)
    contents[DOCS / "database_schema.md"] = markdown(schema)
    for path, content in contents.items():
        if args.check:
            if not path.exists() or path.read_text() != content:
                raise ValueError(f"Generated schema reference is stale: {path.name}")
        else:
            path.write_text(content)
    if args.render:
        config = FIGURES / "mermaid.json"
        config.write_text(
            json.dumps(
                {
                    "theme": "neutral",
                    "deterministicIds": True,
                    "deterministicIDSeed": "aselbox-schema",
                    "er": {"useMaxWidth": False, "fontSize": 14},
                }
            )
            + "\n"
        )
        docker = shutil.which("docker")
        if docker is None:
            raise RuntimeError("Rendering requires Docker.")
        for path in sorted(path for path in contents if path.suffix == ".mmd"):
            subprocess.run(  # noqa: S603 - fixed renderer with repository-owned diagram paths
                [
                    docker,
                    "run",
                    "--rm",
                    "-v",
                    f"{FIGURES}:/data",
                    RENDERER,
                    "-i",
                    path.name,
                    "-o",
                    path.with_suffix(".svg").name,
                    "-c",
                    config.name,
                    "-b",
                    "white",
                ],
                check=True,
            )
    print("Schema figures verified." if args.check else "Schema figures generated.")


if __name__ == "__main__":
    main()
