mod card_format;

use felica::felica_standard::{BlockListElement, FelicaStandard, ServiceCode};
use felica::{ReaderPreference, open_reader};
use serde_json::json;
use std::error::Error;
use std::env;

fn usb_devices() -> Vec<serde_json::Value> {
    let Ok(devices) = rusb::devices() else { return Vec::new() };
    devices
        .iter()
        .filter_map(|device| {
            let descriptor = device.device_descriptor().ok()?;
            let open_result = if descriptor.vendor_id() == 0x054C && descriptor.product_id() == 0x0DC8 {
                match device.open() {
                    Ok(_) => "ok".to_string(),
                    Err(error) => format!("error: {error:?} ({error})"),
                }
            } else {
                "not-tested".to_string()
            };
            let configurations = (0..descriptor.num_configurations())
                .filter_map(|index| device.config_descriptor(index).ok())
                .map(|config| {
                    let interfaces: Vec<_> = config.interfaces().map(|interface| {
                        let descriptors: Vec<_> = interface.descriptors().map(|alternate| {
                            let endpoints: Vec<_> = alternate.endpoint_descriptors().map(|endpoint| json!({
                                "address": format!("{:02X}", endpoint.address()),
                                "type": format!("{:?}", endpoint.transfer_type())
                            })).collect();
                            json!({ "number": alternate.interface_number(), "endpoints": endpoints })
                        }).collect();
                        json!(descriptors)
                    }).collect();
                    json!({ "number": config.number(), "interfaces": interfaces })
                })
                .collect::<Vec<_>>();
            Some(json!({
                "vendorId": format!("{:04X}", descriptor.vendor_id()),
                "productId": format!("{:04X}", descriptor.product_id()),
                "bus": device.bus_number(),
                "address": device.address(),
                "open": open_result,
                "configurations": configurations
            }))
        })
        .collect()
}

fn read_card() -> Result<serde_json::Value, Box<dyn Error>> {
    let mut reader = open_reader(ReaderPreference::ForcePort400)?;
    let reader_name = format!(
        "{} {}",
        reader.vendor_name().unwrap_or("Sony"),
        reader.product_name().unwrap_or("RC-S300")
    );
    let (mut card, _) = FelicaStandard::polling_multi(
        reader.driver_mut(),
        &["212F", "424F"],
        0x88B4,
        0x01,
        0x00,
    )?;
    let idm = hex::encode_upper(card.idm());
    let pmm = hex::encode_upper(card.pmm());
    let service_codes = [ServiceCode::new(0x000B)];
    let mut blocks = Vec::with_capacity(14);
    for number in 0..14 {
        let block_list = [BlockListElement::new(number, 0, 0)];
        let mut response = card.read_without_encryption(&service_codes, &block_list)?;
        let block = response
            .pop()
            .ok_or_else(|| format!("block {number} returned no data"))?;
        blocks.push(block);
    }
    let card_blocks: Vec<[u8; card_format::BLOCK_SIZE]> = blocks
        .iter()
        .map(|block| block.as_slice().try_into())
        .collect::<Result<_, _>>()?;
    let active = card_format::active_slot(&card_blocks)?;
    let block_json: Vec<serde_json::Value> = blocks
        .iter()
        .enumerate()
        .map(|(number, data)| json!({ "number": number, "hex": hex::encode_upper(data) }))
        .collect();
    Ok(json!({
        "ok": true,
        "reader": reader_name.trim(),
        "idm": idm,
        "pmm": pmm,
        "serviceCode": "000B",
        "blockCount": block_json.len(),
        "cardData": active.map(|slot| json!({
            "format": "MEX1",
            "slot": slot.index,
            "sequence": slot.sequence,
            "payloadHex": hex::encode_upper(slot.payload)
        })),
        "blocks": block_json
    }))
}

fn write_card(payload: &[u8], expected_idm: &str) -> Result<serde_json::Value, Box<dyn Error>> {
    let mut reader = open_reader(ReaderPreference::ForcePort400)?;
    let (mut card, _) = FelicaStandard::polling_multi(
        reader.driver_mut(),
        &["212F", "424F"],
        0x88B4,
        0x01,
        0x00,
    )?;
    let idm = hex::encode_upper(card.idm());
    if idm != expected_idm.trim().to_uppercase() {
        return Err(format!("card IDm mismatch: expected {expected_idm}, found {idm}").into());
    }

    let read_service = [ServiceCode::new(0x000B)];
    let write_service = [ServiceCode::new(0x0009)];
    let mut before = [[0u8; card_format::BLOCK_SIZE]; card_format::BLOCK_COUNT];
    for number in 0..card_format::BLOCK_COUNT {
        let list = [BlockListElement::new(number as u16, 0, 0)];
        let mut response = card.read_without_encryption(&read_service, &list)?;
        before[number] = response
            .pop()
            .ok_or_else(|| format!("block {number} returned no data"))?
            .as_slice()
            .try_into()?;
    }

    let previous = card_format::active_slot(&before)?;
    let (slot_index, sequence) = card_format::next_slot(&before)?;
    let planned = card_format::encode_slot(slot_index, sequence, payload)?;
    let start = slot_index as usize * card_format::SLOT_BLOCKS;

    // The header is the commit record. Write and verify data blocks first.
    for local_index in 1..card_format::SLOT_BLOCKS {
        let physical = start + local_index;
        let list = [BlockListElement::new(physical as u16, 0, 0)];
        card.write_without_encryption(&write_service, &list, &planned[local_index])?;
        let mut response = card.read_without_encryption(&read_service, &list)?;
        let verified = response.pop().ok_or_else(|| format!("block {physical} returned no data"))?;
        if verified.as_slice() != planned[local_index] {
            return Err(format!("verification failed for data block {physical}").into());
        }
    }

    let header_list = [BlockListElement::new(start as u16, 0, 0)];
    card.write_without_encryption(&write_service, &header_list, &planned[0])?;
    let mut response = card.read_without_encryption(&read_service, &header_list)?;
    let header = response.pop().ok_or("header returned no data")?;
    if header.as_slice() != planned[0] {
        return Err("verification failed for commit header".into());
    }

    let mut after = before;
    after[start..start + card_format::SLOT_BLOCKS].copy_from_slice(&planned);
    let active = card_format::active_slot(&after)?.ok_or("written slot did not validate")?;
    if active.index != slot_index || active.sequence != sequence || active.payload != payload {
        return Err("written slot did not become the active valid record".into());
    }

    Ok(json!({
        "ok": true,
        "written": true,
        "idm": idm,
        "slot": slot_index,
        "sequence": sequence,
        "payloadLength": payload.len(),
        "crc32": format!("{:08X}", card_format::crc32(payload)),
        "previousSlot": previous.map(|slot| slot.index)
    }))
}

fn plan_write(payload: &[u8], slot: u8, sequence: u32) -> Result<serde_json::Value, Box<dyn Error>> {
    let blocks = card_format::encode_slot(slot, sequence, payload)?;
    let start = slot as usize * card_format::SLOT_BLOCKS;
    let order: Vec<_> = (1..card_format::SLOT_BLOCKS)
        .chain(std::iter::once(0))
        .map(|local| json!({
            "block": start + local,
            "phase": if local == 0 { "commit" } else { "data" },
            "hex": hex::encode_upper(blocks[local])
        }))
        .collect();
    Ok(json!({
        "ok": true,
        "dryRun": true,
        "format": "MEX1",
        "slot": slot,
        "sequence": sequence,
        "payloadLength": payload.len(),
        "payloadCapacity": card_format::SLOT_PAYLOAD_SIZE,
        "crc32": format!("{:08X}", card_format::crc32(payload)),
        "writeOrder": order
    }))
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let operation: Result<serde_json::Value, Box<dyn Error>> = match args.get(1).map(String::as_str) {
        Some("--plan-hex") => (|| {
            let payload = hex::decode(args.get(2).ok_or("--plan-hex requires a hexadecimal payload")?)?;
            let slot = args.get(3).map(|value| value.parse()).transpose()?.unwrap_or(0);
            let sequence = args.get(4).map(|value| value.parse()).transpose()?.unwrap_or(1);
            plan_write(&payload, slot, sequence)
        })(),
        Some("--write-hex") => (|| {
            let payload = hex::decode(args.get(2).ok_or("--write-hex requires a hexadecimal payload")?)?;
            if args.get(3).map(String::as_str) != Some("--confirm-idm") {
                return Err("--write-hex requires --confirm-idm followed by the expected card IDm".into());
            }
            write_card(&payload, args.get(4).ok_or("missing expected card IDm")?)
        })(),
        Some(other) => Err(format!("unknown option: {other}").into()),
        None => read_card(),
    };
    match operation {
        Ok(result) => println!("{result}"),
        Err(error) => {
            println!("{}", json!({ "ok": false, "error": error.to_string(), "usbDevices": usb_devices() }));
            std::process::exit(1);
        }
    }
}
