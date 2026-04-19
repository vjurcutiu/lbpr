import importlib
import sys
import types


def test_orchestrator_import_does_not_initialize_sparse_encoder():
    for name in [
        'features.rag.orchestrator',
        'features.rag.embedder',
        'features.rag.sparse',
        'features.rag.vectorstore',
        'features.rag.chunker',
        'features.rag.schemas',
        'core.namespaces',
    ]:
        sys.modules.pop(name, None)

    sparse_calls = {'count': 0}

    fake_embedder = types.ModuleType('features.rag.embedder')
    fake_embedder.embed_texts = lambda texts: [[0.1] for _ in texts]
    fake_embedder.embed_one = lambda text: [0.1]

    class FakeSparseEncoder:
        def __init__(self):
            sparse_calls['count'] += 1

        def encode_doc(self, text):
            return {'indices': [1], 'values': [1.0]}

        def encode_query(self, text):
            return {'indices': [1], 'values': [1.0]}

    fake_sparse = types.ModuleType('features.rag.sparse')
    fake_sparse.SparseEncoder = FakeSparseEncoder

    class FakeStore:
        def upsert_chunks(self, dataset, entries):
            return None

        def query_hybrid(self, dataset, q_dense, q_sparse, k=5, fusion='rrf', alpha=0.5, filter=None):
            return []

    fake_vectorstore = types.ModuleType('features.rag.vectorstore')
    fake_vectorstore.get_store = lambda: FakeStore()

    fake_chunker = types.ModuleType('features.rag.chunker')
    fake_chunker.simple_word_chunker = lambda text: []

    class Dummy:
        def __init__(self, *args, **kwargs):
            self.__dict__.update(kwargs)

    fake_schemas = types.ModuleType('features.rag.schemas')
    fake_schemas.IngestRequest = Dummy
    fake_schemas.IngestResponse = Dummy
    fake_schemas.QueryRequest = Dummy
    fake_schemas.QueryResponse = Dummy
    fake_schemas.Source = Dummy

    fake_namespaces = types.ModuleType('core.namespaces')
    fake_namespaces.pinecone_namespace = lambda uid, dataset: f'{uid}:{dataset}'

    sys.modules['features.rag.embedder'] = fake_embedder
    sys.modules['features.rag.sparse'] = fake_sparse
    sys.modules['features.rag.vectorstore'] = fake_vectorstore
    sys.modules['features.rag.chunker'] = fake_chunker
    sys.modules['features.rag.schemas'] = fake_schemas
    sys.modules['core.namespaces'] = fake_namespaces

    orchestrator = importlib.import_module('features.rag.orchestrator')

    assert sparse_calls['count'] == 0
    assert orchestrator._sparse is None

    sparse = orchestrator._get_sparse()

    assert sparse is not None
    assert sparse_calls['count'] == 1
    assert orchestrator._sparse is sparse
