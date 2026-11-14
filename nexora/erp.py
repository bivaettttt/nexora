from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from lxml import etree

from nexora.auth import internal
from nexora.db import engine, run
from nexora.projections import read_projection, sync_profile
from nexora.soap import CONTRACTS, MAX_XML, NS, decode, encode, fault
from nexora.source import check_availability, install_fault_control

app = FastAPI(title="Nexora ERP", version="1.0.0")
install_fault_control(app)


@app.get("/health")
def health():
    with engine().connect() as conn:
        run(conn, "SELECT 1")
    return {"status": "ok"}


@app.get("/partner.wsdl")
def wsdl():
    return Response((CONTRACTS / "partner.wsdl").read_bytes(), media_type="text/xml")


@app.get("/partner.xsd")
def xsd():
    return Response((CONTRACTS / "partner.xsd").read_bytes(), media_type="text/xml")


def process(operation, fields):
    identifier = UUID(fields["GlobalId"])
    with engine().begin() as conn:
        check_availability(conn)
        if operation == "UpsertPartner":
            outcome = sync_profile(
                conn,
                "partners",
                identifier,
                int(fields["Version"]),
                fields["LegalName"],
            )
            return encode("UpsertPartnerResponse", {"Outcome": outcome})
        record = read_projection(conn, "partners", identifier)
        return encode(
            "GetPartnerResponse",
            {
                "GlobalId": record["id"],
                "LocalId": record["local_id"],
                "Version": record["version"],
                "LegalName": record["name"],
            },
        )


@app.post("/soap", dependencies=[Depends(internal)], response_class=Response)
async def soap(request: Request):
    try:
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > MAX_XML:
                raise ValueError("XML_LIMIT")
            raw.extend(chunk)
        operation, data = decode(bytes(raw))
        if (
            operation not in {"UpsertPartner", "GetPartner"}
            or request.headers.get("SOAPAction", "").strip('"') != f"{NS}:{operation}"
        ):
            raise ValueError("INVALID_OPERATION")
        reply = await run_in_threadpool(process, operation, data)
        return Response(reply, media_type="text/xml")
    except (ValueError, etree.LxmlError):
        return Response(
            fault("Client", "INVALID_CONTRACT"), status_code=500, media_type="text/xml"
        )
    except HTTPException as error:
        kind = "Server" if error.status_code >= 500 else "Client"
        return Response(
            fault(kind, str(error.detail)), status_code=500, media_type="text/xml"
        )
