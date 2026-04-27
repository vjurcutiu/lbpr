from features.billing import router as billing


class FakeDoc:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    def to_dict(self):
        return dict(self._data)


class FakePriceCollection:
    def __init__(self, prices):
        self._prices = prices

    def stream(self):
        return [FakeDoc(price["id"], price) for price in self._prices]


class FakeProductDocument:
    def __init__(self, prices):
        self._prices = prices

    def collection(self, name):
        assert name == "prices"
        return FakePriceCollection(self._prices)


class FakeProductCollection:
    def __init__(self, products, prices_by_product):
        self._products = products
        self._prices_by_product = prices_by_product

    def where(self, *_args):
        return self

    def stream(self):
        return [FakeDoc(product["id"], product) for product in self._products if product.get("active") is True]

    def document(self, product_id):
        return FakeProductDocument(self._prices_by_product[product_id])


class FakeDb:
    def __init__(self, products, prices_by_product):
        self._products = products
        self._prices_by_product = prices_by_product

    def collection(self, name):
        assert name == "products"
        return FakeProductCollection(self._products, self._prices_by_product)


def test_select_price_prefers_product_default_price_over_cheapest_active_price():
    db = FakeDb(
        products=[
            {
                "id": "prod_pro",
                "active": True,
                "name": "LexBot Pro",
                "metadata": {"code": "pro"},
                "default_price": "price_pro_real",
            }
        ],
        prices_by_product={
            "prod_pro": [
                {
                    "id": "price_intro_old",
                    "active": True,
                    "type": "recurring",
                    "unit_amount": 100,
                    "currency": "usd",
                    "recurring": {"interval": "month", "interval_count": 1},
                },
                {
                    "id": "price_pro_real",
                    "active": True,
                    "type": "recurring",
                    "unit_amount": 15000,
                    "currency": "usd",
                    "recurring": {"interval": "month", "interval_count": 1},
                },
            ]
        },
    )

    _, price = billing._select_price_for_plan(db, "pro")

    assert price["id"] == "price_pro_real"


def test_select_price_can_match_legacy_product_name_and_lookup_key():
    db = FakeDb(
        products=[
            {
                "id": "prod_pro",
                "active": True,
                "name": "LexBot PRO - 1 Month",
                "metadata": {},
                "default_price": None,
            }
        ],
        prices_by_product={
            "prod_pro": [
                {
                    "id": "price_pro_monthly",
                    "active": True,
                    "type": "recurring",
                    "unit_amount": 15000,
                    "currency": "usd",
                    "lookup_key": "pro_monthly",
                    "recurring": {"interval": "month", "interval_count": 1},
                }
            ]
        },
    )

    _, price = billing._select_price_for_plan(db, "pro")

    assert price["id"] == "price_pro_monthly"
