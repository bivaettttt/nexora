from pathlib import Path

from lxml import etree

NS = "urn:nexora:partner:v1"
SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
CONTRACTS = Path(__file__).parent / "contracts"
SCHEMA = etree.XMLSchema(etree.parse(str(CONTRACTS / "partner.xsd")))
MAX_XML = 32768


def tag(ns, name):
    return f"{{{ns}}}{name}"


def encode(operation, fields):
    root = etree.Element(tag(SOAP, "Envelope"), nsmap={"soap": SOAP, "p": NS})
    body = etree.SubElement(root, tag(SOAP, "Body"))
    payload = etree.SubElement(body, tag(NS, operation))
    for field, value in fields.items():
        etree.SubElement(payload, tag(NS, field)).text = str(value)
    SCHEMA.assertValid(payload)
    return etree.tostring(root, encoding="utf-8", xml_declaration=True)


def fault(kind, code):
    root = etree.Element(tag(SOAP, "Envelope"), nsmap={"soap": SOAP})
    body = etree.SubElement(root, tag(SOAP, "Body"))
    payload = etree.SubElement(body, tag(SOAP, "Fault"))
    etree.SubElement(payload, "faultcode").text = f"soap:{kind}"
    etree.SubElement(payload, "faultstring").text = code
    return etree.tostring(root, encoding="utf-8", xml_declaration=True)


def decode(raw, *, accept_fault=False):
    if len(raw) > MAX_XML:
        raise ValueError("XML_LIMIT")
    parser = etree.XMLParser(
        resolve_entities=False, no_network=True, load_dtd=False, recover=False
    )
    root = etree.fromstring(raw, parser)
    if root.getroottree().docinfo.doctype:
        raise ValueError("DTD_FORBIDDEN")
    if (
        root.tag != tag(SOAP, "Envelope")
        or len(root) != 1
        or root[0].tag != tag(SOAP, "Body")
        or len(root[0]) != 1
    ):
        raise ValueError("INVALID_ENVELOPE")
    payload = root[0][0]
    if accept_fault and payload.tag == tag(SOAP, "Fault"):
        return "Fault", {str(child.tag): child.text for child in payload}
    SCHEMA.assertValid(payload)
    return etree.QName(payload).localname, {
        etree.QName(child).localname: child.text for child in payload
    }
