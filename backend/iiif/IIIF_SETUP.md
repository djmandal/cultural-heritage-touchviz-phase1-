# Run the IIIF Image API service

The backend writes one high-resolution RGB master image per uploaded dataset. Cantaloupe serves those files through IIIF Image API 3 on demand and caches requested derivatives on disk. This avoids generating a separate tile pyramid for every upload.

## First-time setup

Install Java 17 or newer. Cantaloupe 5.0.7 is the latest published release on the [official release page](https://github.com/cantaloupe-project/cantaloupe/releases). It uses the University of Illinois/NCSA Open Source License; keep its third-party notices with your deployment.

In a terminal, from the project root, run:

```sh
curl -L https://github.com/cantaloupe-project/cantaloupe/releases/download/v5.0.7/cantaloupe-5.0.7.zip -o /tmp/cantaloupe-5.0.7.zip
mkdir -p /tmp/cantaloupe-5.0.7
unzip -q /tmp/cantaloupe-5.0.7.zip -d /tmp/cantaloupe-5.0.7
mkdir -p backend/data/iiif-cache
export FILESYSTEMSOURCE_BASICLOOKUPSTRATEGY_PATH_PREFIX="$PWD/backend/data/derived/"
export FILESYSTEMCACHE_PATHNAME="$PWD/backend/data/iiif-cache"
java -Dcantaloupe.config="$PWD/backend/iiif/cantaloupe.properties" -Xmx2g -jar "$(find /tmp/cantaloupe-5.0.7 -name 'cantaloupe-5.0.7.jar' -print -quit)"
```

Keep this service running alongside the FastAPI backend. The kiosk uses port `8182` on the same host by default. If IIIF is on another host or public domain, set `VITE_IIIF_BASE_URL` for the kiosk to that origin, such as `https://images.example.org`.

## Check the service

After uploading a dataset with **IIIF high-resolution viewing** selected, open its `info.json` URL from the dataset detail response. A URL should look like:

```text
http://localhost:8182/iiif/3/dataset-id%2Fmaster%2Frgb-master.png/info.json
```

The service returns IIIF image information there and serves zoom tiles from the same identifier. Existing `.dzi` sources remain viewable in OpenSeadragon.

For production, put the service behind HTTPS and a reverse proxy, use a persistent cache volume, and restrict the source root and network access to the intended deployment. Cantaloupe's own [deployment and tuning guide](https://cantaloupe-project.github.io/manual/5.0/deployment.html) covers proxy, cache, resource, and TLS configuration.
