"""Generate GeoJSON"""
import math
import networkx as nx
from typing import Optional

def to_geojson(G, bbox: Optional[dict] = None, removed_nodes: Optional[set] = None, removed_edges: Optional[set] = None):
    """Convert graph to GeoJSON with optional bbox filter
    
    Args:
        G: NetworkX graph
        bbox: Optional dict with keys minLat, maxLat, minLon, maxLon
        removed_nodes: Set of removed node IDs
        removed_edges: Set of removed edge tuples (normalized)
    """
    import networkx as nx
    
    removed_nodes = removed_nodes or set()
    removed_edges = removed_edges or set()
    
    # Extract bbox if provided
    min_lat = bbox.get("minLat") if bbox is not None else None
    max_lat = bbox.get("maxLat") if bbox is not None else None
    min_lon = bbox.get("minLon") if bbox is not None else None
    max_lon = bbox.get("maxLon") if bbox is not None else None
    
    def in_bbox(lat: float, lon: float) -> bool:
        """Check if coordinates are in bbox"""
        if bbox is None:
            return True
        if min_lat is not None and lat < min_lat:
            return False
        if max_lat is not None and lat > max_lat:
            return False
        if min_lon is not None and lon < min_lon:
            return False
        if max_lon is not None and lon > max_lon:
            return False
        return True
    
    # Nodes - sample airports (tối ưu: chỉ lấy airports có routes)
    # Tính nodes_with_routes từ các edges KHÔNG bị removed
    nodes = []
    nodes_with_routes = set()
    for src, dst in G.edges():
        # Chỉ thêm nodes nếu cả hai đều không bị removed và edge không bị removed
        edge_tuple = tuple(sorted([src, dst]))
        if (src not in removed_nodes and dst not in removed_nodes and 
            edge_tuple not in removed_edges):
            nodes_with_routes.add(src)
            nodes_with_routes.add(dst)
    
    for node_id, data in G.nodes(data=True):
        # Bỏ qua các nodes đã bị removed - không hiển thị trên map
        if node_id in removed_nodes:
            continue
            
        # Chỉ lấy airports có routes (và routes đó không bị removed)
        if node_id in nodes_with_routes and "lat" in data and "lon" in data:
            lat, lon = data["lat"], data["lon"]
            if (not math.isnan(lat) and not math.isnan(lon) and
                -90 <= lat <= 90 and -180 <= lon <= 180 and
                in_bbox(lat, lon)):  # Filter by bbox
                nodes.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "id": int(node_id),
                        "name": str(data.get("name", "")),
                        "city": str(data.get("city", "")),
                        "country": str(data.get("country", "")),
                        "iata": str(data.get("iata", "")),
                        "icao": str(data.get("icao", ""))
                    }
                })
    
    # Edges - lấy full routes từ data ban đầu
    edges = []
    edge_list = list(G.edges(data=True))
    
    for src, dst, data in edge_list:
        # Bỏ qua edge nếu một trong hai node đã bị removed
        if src in removed_nodes or dst in removed_nodes:
            continue
            
        src_data = G.nodes[src]
        dst_data = G.nodes[dst]
        
        if ("lat" in src_data and "lon" in src_data and
            "lat" in dst_data and "lon" in dst_data):
            src_lat, src_lon = src_data["lat"], src_data["lon"]
            dst_lat, dst_lon = dst_data["lat"], dst_data["lon"]
            
            if (not math.isnan(src_lat) and not math.isnan(src_lon) and
                not math.isnan(dst_lat) and not math.isnan(dst_lon)):
                # Only include routes where at least one endpoint is in bbox
                if in_bbox(src_lat, src_lon) or in_bbox(dst_lat, dst_lon):
                    edge_tuple = tuple(sorted([src, dst]))
                    # Bỏ qua các edges đã bị removed - không hiển thị trên map
                    if edge_tuple in removed_edges:
                        continue
                    
                    edges.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[src_lon, src_lat], [dst_lon, dst_lat]]
                        },
                        "properties": {
                            "source": int(src),
                            "target": int(dst)
                        }
                    })
    
    return {
        "airports": {"type": "FeatureCollection", "features": nodes},
        "routes": {"type": "FeatureCollection", "features": edges}
    }

