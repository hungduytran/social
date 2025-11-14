"""Load OpenFlights data"""
import pandas as pd
import networkx as nx
import os
from geopy.distance import great_circle
import math

def load_airports(path: str) -> pd.DataFrame:
    """Load airports.dat"""
    cols = ["id", "name", "city", "country", "iata", "icao", 
            "lat", "lon", "alt", "tz", "dst", "tz_db", "type", "source"]
    
    df = pd.read_csv(
        path, header=None, names=cols,
        na_values=["\\N"], keep_default_na=False,
        encoding="utf-8", quotechar='"'
    )
    
    # Convert numeric
    for col in ["id", "lat", "lon", "alt", "tz"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    
    return df

def load_routes(path: str) -> pd.DataFrame:
    """Load routes.dat"""
    cols = ["airline", "airline_id", "src_ap", "src_id", 
            "dst_ap", "dst_id", "codeshare", "stops", "equipment"]
    
    df = pd.read_csv(
        path, header=None, names=cols,
        na_values=["\\N"], keep_default_na=False,
        encoding="utf-8", quotechar='"'
    )
    
    # Convert numeric
    for col in ["airline_id", "src_id", "dst_id", "stops"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    
    # Remove invalid routes
    df = df.dropna(subset=["src_id", "dst_id"])
    df["src_id"] = df["src_id"].astype(int)
    df["dst_id"] = df["dst_id"].astype(int)
    
    return df

def load_and_build_graph(airports_path: str, routes_path: str) -> nx.Graph:
    """Load data and build graph"""
    print(f"Loading airports from: {airports_path}")
    airports = load_airports(airports_path)
    print(f"Loaded {len(airports)} airports")
    
    print(f"Loading routes from: {routes_path}")
    routes = load_routes(routes_path)
    print(f"Loaded {len(routes)} routes")
    
    # Build graph
    G = nx.Graph()
    
    # Add nodes
    for _, ap in airports.iterrows():
        if pd.notna(ap["lat"]) and pd.notna(ap["lon"]):
            G.add_node(
                int(ap["id"]),
                name=ap["name"],
                city=ap["city"],
                country=ap["country"],
                iata=ap["iata"],
                icao=ap["icao"],
                lat=float(ap["lat"]),
                lon=float(ap["lon"])
            )
    
    # Add edges
    valid_ids = set(G.nodes())
    for _, route in routes.iterrows():
        src = int(route["src_id"])
        dst = int(route["dst_id"])
        
        if src in valid_ids and dst in valid_ids and src != dst:
            # Calculate distance
            src_data = G.nodes[src]
            dst_data = G.nodes[dst]
            
            try:
                dist = great_circle(
                    (src_data["lat"], src_data["lon"]),
                    (dst_data["lat"], dst_data["lon"])
                ).kilometers
            except:
                dist = None
            
            G.add_edge(src, dst, distance_km=dist)
    
    return G

