use crc32fast::Hasher;

pub const BLOCK_SIZE: usize = 16;
pub const BLOCK_COUNT: usize = 14;
pub const SLOT_BLOCKS: usize = 7;
pub const SLOT_PAYLOAD_SIZE: usize = (SLOT_BLOCKS - 1) * BLOCK_SIZE;
const MAGIC: &[u8; 4] = b"MEX1";
const FORMAT_VERSION: u8 = 1;
const COMMITTED: u8 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Slot {
    pub index: u8,
    pub sequence: u32,
    pub payload: Vec<u8>,
}

pub fn crc32(payload: &[u8]) -> u32 {
    let mut hasher = Hasher::new();
    hasher.update(payload);
    hasher.finalize()
}

pub fn encode_slot(index: u8, sequence: u32, payload: &[u8]) -> Result<[[u8; BLOCK_SIZE]; SLOT_BLOCKS], String> {
    if index > 1 {
        return Err("slot index must be 0 or 1".into());
    }
    if payload.len() > SLOT_PAYLOAD_SIZE {
        return Err(format!("payload exceeds {SLOT_PAYLOAD_SIZE} bytes"));
    }
    let mut blocks = [[0u8; BLOCK_SIZE]; SLOT_BLOCKS];
    blocks[0][0..4].copy_from_slice(MAGIC);
    blocks[0][4] = FORMAT_VERSION;
    blocks[0][5] = index;
    blocks[0][6..10].copy_from_slice(&sequence.to_le_bytes());
    blocks[0][10] = payload.len() as u8;
    blocks[0][11] = COMMITTED;
    blocks[0][12..16].copy_from_slice(&crc32(payload).to_le_bytes());
    for (offset, byte) in payload.iter().enumerate() {
        blocks[1 + offset / BLOCK_SIZE][offset % BLOCK_SIZE] = *byte;
    }
    Ok(blocks)
}

pub fn decode_slot(index: u8, card_blocks: &[[u8; BLOCK_SIZE]]) -> Result<Option<Slot>, String> {
    if index > 1 || card_blocks.len() != BLOCK_COUNT {
        return Err("invalid slot index or card block count".into());
    }
    let start = index as usize * SLOT_BLOCKS;
    let header = &card_blocks[start];
    if &header[0..4] != MAGIC {
        return Ok(None);
    }
    if header[4] != FORMAT_VERSION || header[5] != index || header[11] != COMMITTED {
        return Ok(None);
    }
    let sequence = u32::from_le_bytes(header[6..10].try_into().unwrap());
    let length = header[10] as usize;
    if length > SLOT_PAYLOAD_SIZE {
        return Ok(None);
    }
    let expected_crc = u32::from_le_bytes(header[12..16].try_into().unwrap());
    let mut payload = Vec::with_capacity(length);
    for block in &card_blocks[start + 1..start + SLOT_BLOCKS] {
        payload.extend_from_slice(block);
    }
    payload.truncate(length);
    if crc32(&payload) != expected_crc {
        return Ok(None);
    }
    Ok(Some(Slot { index, sequence, payload }))
}

pub fn active_slot(card_blocks: &[[u8; BLOCK_SIZE]]) -> Result<Option<Slot>, String> {
    let a = decode_slot(0, card_blocks)?;
    let b = decode_slot(1, card_blocks)?;
    Ok(match (a, b) {
        (Some(a), Some(b)) => Some(if b.sequence > a.sequence { b } else { a }),
        (Some(slot), None) | (None, Some(slot)) => Some(slot),
        (None, None) => None,
    })
}

pub fn next_slot(card_blocks: &[[u8; BLOCK_SIZE]]) -> Result<(u8, u32), String> {
    Ok(match active_slot(card_blocks)? {
        Some(active) => (1 - active.index, active.sequence.saturating_add(1)),
        None => (0, 1),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_card() -> [[u8; BLOCK_SIZE]; BLOCK_COUNT] {
        [[0u8; BLOCK_SIZE]; BLOCK_COUNT]
    }

    fn put_slot(card: &mut [[u8; BLOCK_SIZE]; BLOCK_COUNT], slot: [[u8; BLOCK_SIZE]; SLOT_BLOCKS], index: usize) {
        card[index * SLOT_BLOCKS..(index + 1) * SLOT_BLOCKS].copy_from_slice(&slot);
    }

    #[test]
    fn round_trip_and_choose_newest_slot() {
        let mut card = blank_card();
        put_slot(&mut card, encode_slot(0, 1, b"first").unwrap(), 0);
        put_slot(&mut card, encode_slot(1, 2, b"second").unwrap(), 1);
        let active = active_slot(&card).unwrap().unwrap();
        assert_eq!(active.index, 1);
        assert_eq!(active.sequence, 2);
        assert_eq!(active.payload, b"second");
        assert_eq!(next_slot(&card).unwrap(), (0, 3));
    }

    #[test]
    fn rejects_corrupt_and_oversized_payloads() {
        assert!(encode_slot(0, 1, &[0u8; SLOT_PAYLOAD_SIZE + 1]).is_err());
        let mut card = blank_card();
        put_slot(&mut card, encode_slot(0, 1, b"valid").unwrap(), 0);
        card[1][0] ^= 0xff;
        assert!(decode_slot(0, &card).unwrap().is_none());
    }

    #[test]
    fn uncommitted_header_is_ignored() {
        let mut card = blank_card();
        put_slot(&mut card, encode_slot(0, 1, b"value").unwrap(), 0);
        card[0][11] = 0;
        assert!(active_slot(&card).unwrap().is_none());
    }
}
