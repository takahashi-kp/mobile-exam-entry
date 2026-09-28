use felica::felica_standard::{BlockListElement, FelicaStandard, ServiceCode};
use felica::{ReaderPreference, open_reader};
use serde_json::json;
use std::error::Error;

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
        "blocks": block_json
    }))
}

fn main() {
    match read_card() {
        Ok(result) => println!("{result}"),
        Err(error) => {
            println!("{}", json!({ "ok": false, "error": error.to_string(), "usbDevices": usb_devices() }));
            std::process::exit(1);
        }
    }
}
