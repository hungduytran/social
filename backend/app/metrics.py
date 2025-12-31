"""Network metrics – unified for undirected (Graph) & directed (DiGraph).

This module exposes utility functions that automatically choose the
appropriate definition of the *largest component* depending on whether
the graph is directed (LSCC – largest strongly-connected component) or
undirected (LCC – largest connected component).

Only a lightweight subset of metrics is provided to keep the web API
responsive.  (ASPL is hard-disabled for performance.)
"""
from __future__ import annotations

from typing import Set
import networkx as nx

__all__ = [
    "get_lcc",
    "lcc_size",
    "diameter",
    "aspl",
    "components_count",
    "get_stats",
]

###############################################################################
# Internal helpers
###############################################################################

def _largest_component_nodes(G: nx.Graph) -> Set[int]:
    """Return node set of largest (strongly) connected component."""
    if len(G) == 0:
        return set()

    if G.is_directed():
        # For DiGraph use *strongly* connected components so that every pair
        # is mutually reachable following edge direction.
        return max(nx.strongly_connected_components(G), key=len)  # type: ignore[arg-type]
    # Undirected – standard connected components
    return max(nx.connected_components(G), key=len)  # type: ignore[arg-type]

###############################################################################
# Public API
###############################################################################


def get_lcc(G: nx.Graph) -> Set[int]:
    """Nodes belonging to LCC (undirected) or LSCC (directed)."""
    return _largest_component_nodes(G)


def lcc_size(G: nx.Graph) -> float:
    """Fraction |LCC| / |V| (automatic LSCC for DiGraph)."""
    if len(G) == 0:
        return 0.0
    return len(_largest_component_nodes(G)) / len(G)


def diameter(G: nx.Graph) -> float:
    """Diameter measured on the largest component (0 if not applicable)."""
    nodes = _largest_component_nodes(G)
    if len(nodes) < 2:
        return 0.0

    sub = G.subgraph(nodes)
    try:
        # For directed graphs *sub* is strongly connected so nx.diameter works.
        return float(nx.diameter(sub))  # type: ignore[arg-type]
    except Exception:
        return 0.0


def aspl(_: nx.Graph) -> float:  # noqa: D401 – intentionally simple stub
    """Average shortest-path length – **disabled** to keep API fast."""
    return 0.0


def components_count(G: nx.Graph) -> int:
    """Number of (strongly) connected components."""
    if len(G) == 0:
        return 0

    if G.is_directed():
        return nx.number_strongly_connected_components(G)  # type: ignore[arg-type]
    return nx.number_connected_components(G)  # type: ignore[arg-type]


def get_stats(G: nx.Graph) -> dict:
    """Return minimal set of metrics used by API / visualisations."""
    return {
        "directed": G.is_directed(),
        "nodes": len(G),
        "edges": G.number_of_edges(),
        "lcc_norm": lcc_size(G),
        "diameter": diameter(G),
        "aspl": aspl(G),
        "components": components_count(G),
    }
